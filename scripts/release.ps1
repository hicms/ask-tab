<#
.SYNOPSIS
Pushes the version tag that starts the GitHub release workflow.

.DESCRIPTION
Requires a clean, pushed main branch and matching root and Chrome extension versions.
GitHub Actions builds and publishes the production package after the tag is pushed.

.PARAMETER Publish
Create and push the matching version tag to origin.

.PARAMETER Help
Show usage without creating a tag.

.EXAMPLE
.\scripts\release.ps1 -Publish
#>
param(
    [switch] $Publish,
    [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$usage = @'
Usage: .\scripts\release.ps1 -Publish
       .\scripts\release.ps1 -Help

-Publish tags the current main commit as v<package.json version> and pushes
the tag to origin, starting the GitHub production release workflow.
Configure the repository Actions variable ASKTAB_RELEASE_SERVICE_URL first.
'@

if ($Help) {
    Write-Host $usage
    return
}

if (-not $Publish) {
    Write-Host $usage
    exit 1
}

function Invoke-Git {
    param([string[]] $GitArgs)

    $output = & git @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "git $($GitArgs -join ' ') failed (exit $LASTEXITCODE): $($output -join ' ')"
    }
    return $output
}

$root = Split-Path -Parent $PSScriptRoot
try {
    Push-Location $root
    try {
        $version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
        $chromeVersion = (Get-Content -LiteralPath 'chrome-extension/package.json' -Raw | ConvertFrom-Json).version
        if ([string]::IsNullOrWhiteSpace($version) -or $chromeVersion -cne $version) {
            throw 'Root and Chrome extension package versions must match before releasing.'
        }
        $tag = "v$version"

        if (Invoke-Git -GitArgs @('status', '--porcelain', '--untracked-files=all')) {
            throw 'The working tree is not clean. Commit your source changes before releasing.'
        }

        $branch = Invoke-Git -GitArgs @('symbolic-ref', '--quiet', '--short', 'HEAD')
        if ($branch -cne 'main') {
            throw "Release from main, not '$branch'."
        }

        $localHead = Invoke-Git -GitArgs @('rev-parse', 'HEAD')
        $remoteMain = Invoke-Git -GitArgs @('ls-remote', '--heads', 'origin', 'main')
        if (-not $remoteMain -or ($remoteMain -split '\s+')[0] -ne $localHead) {
            throw 'Local main must match origin/main. Push the source commit first.'
        }

        if (Invoke-Git -GitArgs @('tag', '--list', $tag)) {
            throw "Local tag $tag already exists."
        }
        if (Invoke-Git -GitArgs @('ls-remote', '--refs', '--tags', 'origin', "refs/tags/$tag")) {
            throw "Remote tag $tag already exists."
        }

        Invoke-Git -GitArgs @('tag', '-a', $tag, '-m', "Release $tag") | Out-Null
        try {
            Invoke-Git -GitArgs @('push', 'origin', "refs/tags/$tag") | Out-Host
        } catch {
            throw "Created local tag $tag, but could not push it. $($_.Exception.Message)"
        }
        Write-Host "Pushed $tag to origin. The GitHub release workflow will build and publish it."
    } finally {
        Pop-Location
    }
} catch {
    Write-Host "error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

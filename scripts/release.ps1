<#
.SYNOPSIS
Publishes a version tag and verifies the GitHub Release.

.DESCRIPTION
Requires a clean, pushed main branch and matching root, Chrome extension and MCP bridge versions.
Increments the patch version by default, commits the three package versions, and pushes
main and the version tag together. Use -Version to choose an explicit version.
GitHub Actions builds and publishes the production package after the tag is pushed.
The command waits for the workflow and verifies the release assets.

.PARAMETER Publish
Update the version and publish the matching version tag to origin.

.PARAMETER Version
Explicit major.minor.patch version. Defaults to the current patch version plus one.

.PARAMETER Help
Show usage without creating a tag.

.EXAMPLE
.\scripts\release.ps1 -Publish

.EXAMPLE
.\scripts\release.ps1 -Publish -Version 0.2.0
#>
param(
    [switch] $Publish,
    [string] $Version,
    [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$usage = @'
Usage: .\scripts\release.ps1 -Publish [-Version 0.2.0]
       .\scripts\release.ps1 -Help

-Publish increments the package.json patch version (for example 0.1.1 -> 0.1.2).
-Version selects an explicit major.minor.patch version instead; it cannot go backwards.
The script updates the three package versions, commits them, pushes main and the tag
together, waits for GitHub Actions, and checks the ZIP, SHA-256 and MCP bridge assets.
Start from a clean main branch that matches origin/main.
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

function Invoke-Gh {
    param([string[]] $GhArgs)

    $output = & gh @GhArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "gh $($GhArgs -join ' ') failed (exit $LASTEXITCODE): $($output -join ' ')"
    }
    return $output
}

function ConvertTo-ReleaseVersion {
    param([string] $Value)

    if ($Value -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
        throw "Invalid version '$Value'. Use major.minor.patch, for example 0.2.0."
    }
    return [version] $Value
}

$root = Split-Path -Parent $PSScriptRoot
try {
    Push-Location $root
    try {
        $currentVersion = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
        $chromeVersion = (Get-Content -LiteralPath 'chrome-extension/package.json' -Raw | ConvertFrom-Json).version
        $bridgeVersion = (Get-Content -LiteralPath 'packages/mcp-bridge/package.json' -Raw | ConvertFrom-Json).version
        if ([string]::IsNullOrWhiteSpace($currentVersion) -or $chromeVersion -cne $currentVersion -or $bridgeVersion -cne $currentVersion) {
            throw 'Root, Chrome extension and MCP bridge package versions must match before releasing.'
        }
        $currentParsed = ConvertTo-ReleaseVersion $currentVersion
        $targetVersion = if ($PSBoundParameters.ContainsKey('Version')) {
            $Version
        } else {
            '{0}.{1}.{2}' -f $currentParsed.Major, $currentParsed.Minor, ($currentParsed.Build + 1)
        }
        $targetParsed = ConvertTo-ReleaseVersion $targetVersion
        if ($targetParsed -lt $currentParsed) {
            throw "Release version $targetVersion cannot be older than $currentVersion."
        }
        $tag = "v$targetVersion"

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

        if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
            throw 'GitHub CLI (gh) is required to verify the release.'
        }
        $repo = Invoke-Gh -GhArgs @('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner')
        if (-not $repo) {
            throw 'Could not identify the GitHub repository.'
        }
        $serviceUrl = Invoke-Gh -GhArgs @('variable', 'get', 'ASKTAB_RELEASE_SERVICE_URL', '--repo', $repo)
        $serviceUri = $null
        if (-not [uri]::TryCreate($serviceUrl, [UriKind]::Absolute, [ref] $serviceUri) -or
            $serviceUri.Scheme -cne 'https' -or
            $serviceUri.UserInfo -or
            $serviceUri.AbsoluteUri -cne "$($serviceUri.GetLeftPart([UriPartial]::Authority))/") {
            throw 'ASKTAB_RELEASE_SERVICE_URL must be an HTTPS origin without a path or credentials.'
        }

        if ($targetVersion -cne $currentVersion) {
            $packagePaths = @('package.json', 'chrome-extension/package.json', 'packages/mcp-bridge/package.json')
            $versionPattern = [regex] '("version"\s*:\s*")[^"]*(")'
            foreach ($path in $packagePaths) {
                $fullPath = Join-Path $root $path
                $content = [IO.File]::ReadAllText($fullPath)
                $updated = $versionPattern.Replace($content, "`${1}$targetVersion`${2}", 1)
                [IO.File]::WriteAllText($fullPath, $updated, [Text.UTF8Encoding]::new($false))
            }
            Invoke-Git -GitArgs (@('add', '--') + $packagePaths) | Out-Null
            Invoke-Git -GitArgs (@('commit', '-m', "Release $tag", '--') + $packagePaths) | Out-Host
            if (Invoke-Git -GitArgs @('status', '--porcelain', '--untracked-files=all')) {
                throw 'The working tree changed during the version commit. Review it before publishing.'
            }
        }

        $localHead = Invoke-Git -GitArgs @('rev-parse', 'HEAD')
        Invoke-Git -GitArgs @('tag', '-a', $tag, '-m', "Release $tag") | Out-Null
        try {
            Invoke-Git -GitArgs @('push', '--atomic', 'origin', 'main', "refs/tags/$tag") | Out-Host
        } catch {
            throw "Release commit and tag $tag are local; the atomic push failed. After resolving the error, retry with: git push --atomic origin main refs/tags/$tag. $($_.Exception.Message)"
        }
        Write-Host "Pushed main and $tag to origin. Waiting for the GitHub release workflow..."

        $runId = $null
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            $runs = Invoke-Gh -GhArgs @('run', 'list', '--repo', $repo, '--workflow', 'release.yml', '--branch', $tag, '--event', 'push', '--limit', '20', '--json', 'databaseId,headSha,headBranch') | ConvertFrom-Json
            $run = $runs | Where-Object { $_.headSha -ceq $localHead -and $_.headBranch -ceq $tag } | Select-Object -First 1
            if ($run) {
                $runId = $run.databaseId
                break
            }
            Start-Sleep -Seconds 2
        }
        if (-not $runId) {
            throw "No GitHub Actions release run appeared for $tag. Check the tag and Actions page."
        }

        & gh run watch $runId --repo $repo --exit-status
        if ($LASTEXITCODE -ne 0) {
            throw "GitHub Actions release workflow failed: https://github.com/$repo/actions/runs/$runId"
        }

        $release = Invoke-Gh -GhArgs @('release', 'view', $tag, '--repo', $repo, '--json', 'url,assets') | ConvertFrom-Json
        $expectedAssets = @("asktab-chrome-$tag.zip", "asktab-chrome-$tag.sha256", "asktab-mcp-$tag.tgz")
        $actualAssets = @($release.assets | ForEach-Object { $_.name })
        foreach ($asset in $expectedAssets) {
            if ($asset -cnotin $actualAssets) {
                throw "GitHub Release $tag is missing $asset."
            }
        }
        Write-Host "Release published and verified: $($release.url)"
    } finally {
        Pop-Location
    }
} catch {
    Write-Host "error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

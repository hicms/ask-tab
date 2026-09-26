<#
.SYNOPSIS
Builds the extension for the selected AskTab service environment.

.PARAMETER Environment
Choose development or test (default: development). The selected service URL comes from .env.

.PARAMETER Help
Show usage without building.

.PARAMETER Full
Build the full extension. By default, only the background script is rebuilt.

.EXAMPLE
.\scripts\build.ps1

.EXAMPLE
.\scripts\build.ps1 -Environment test

.EXAMPLE
.\scripts\build.ps1 -Environment development -Full
#>
param(
    [ValidateSet('development', 'test')]
    [string] $Environment = 'development',
    [switch] $Full,
    [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$usage = @'
Usage: .\scripts\build.ps1 [-Environment <development|test>] [-Full]
       .\scripts\build.ps1 -Help

Examples:
  .\scripts\build.ps1
  .\scripts\build.ps1 -Environment test
  .\scripts\build.ps1 -Environment development -Full

By default, only the background script is rebuilt. Use -Full for the first
build, after changing page code, or when switching environments.
'@

if ($Help) {
    Write-Host $usage
    return
}

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$urlKey = if ($Environment -eq 'development') {
    'CEB_ASK_SERVICE_URL_DEVELOPMENT'
} else {
    'CEB_ASK_SERVICE_URL_TEST'
}

try {
    if (-not (Test-Path -LiteralPath $envFile)) {
        throw "Missing $envFile. Copy .example.env to .env and set $urlKey."
    }

    $url = $null
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match "^\s*$urlKey\s*=\s*(.*)$") {
            $url = $Matches[1].Trim().Trim('"', "'")
        }
    }
    if ([string]::IsNullOrWhiteSpace($url)) {
        throw "Set $urlKey in .env before building the $Environment variant."
    }

    $parsedUrl = $null
    if (-not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref] $parsedUrl) -or
        $parsedUrl.Scheme -notin @('http', 'https') -or
        -not $parsedUrl.Host) {
        throw "$urlKey must be an absolute http:// or https:// URL."
    }

    if (-not $Full) {
        foreach ($page in @('side-panel', 'options', 'full-page-chat')) {
            $pageHtml = Join-Path $root "dist/$page/index.html"
            if (-not (Test-Path -LiteralPath $pageHtml)) {
                throw "Fast build requires page bundles in dist. Run .\scripts\build.ps1 -Environment $Environment -Full first."
            }
        }
    }

    $buildTask = if ($Full) { 'base-build' } else { 'base-build:background' }
    $previousTarget = $env:CLI_CEB_TARGET
    try {
        $env:CLI_CEB_TARGET = $Environment
        Push-Location $root
        try {
            & pnpm.cmd $buildTask
            if ($LASTEXITCODE -ne 0) {
                throw "pnpm $buildTask failed with exit code $LASTEXITCODE"
            }
        } finally {
            Pop-Location
        }
    } finally {
        $env:CLI_CEB_TARGET = $previousTarget
    }

    if ($Full) {
        Write-Host "Built $Environment extension in $(Join-Path $root 'dist') for $url"
    } else {
        Write-Host "Updated $Environment background script in $(Join-Path $root 'dist') for $url"
    }
} catch {
    Write-Host "error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('development', 'test')]
    [string] $Environment
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

    $previousTarget = $env:CLI_CEB_TARGET
    try {
        $env:CLI_CEB_TARGET = $Environment
        Push-Location $root
        try {
            & pnpm.cmd base-build
            if ($LASTEXITCODE -ne 0) {
                throw "pnpm base-build failed with exit code $LASTEXITCODE"
            }
        } finally {
            Pop-Location
        }
    } finally {
        $env:CLI_CEB_TARGET = $previousTarget
    }

    Write-Host "Built $Environment extension in $(Join-Path $root 'dist') for $url"
} catch {
    Write-Host "error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

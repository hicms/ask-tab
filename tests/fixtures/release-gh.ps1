param(
    [switch] $Publish,
    [string] $Version,
    [switch] $Help
)

# Only GitHub is simulated; the release script operates on a real local Git remote.
function gh {
    $global:LASTEXITCODE = 0
    switch ("$($args[0]) $($args[1])") {
        'repo view' { 'test/ask-tab' }
        'variable get' {
            if ($env:RELEASE_TEST_FAILURE -eq 'config') { 'http://invalid.example' }
            else { 'https://asktab.example.com' }
        }
        'run list' {
            $tag = $args[[Array]::IndexOf($args, '--branch') + 1]
            @(@{ databaseId = 1; headSha = (& git rev-parse HEAD); headBranch = $tag }) |
                ConvertTo-Json -Compress
        }
        'run watch' {
            if ($env:RELEASE_TEST_FAILURE -eq 'workflow') { $global:LASTEXITCODE = 1 }
        }
        'release view' {
            $tag = $args[2]
            $assets = @(@{ name = "asktab-chrome-$tag.zip" })
            if ($env:RELEASE_TEST_FAILURE -ne 'asset') {
                $assets += @{ name = "asktab-chrome-$tag.sha256" }
            }
            @{ url = "https://example.com/releases/$tag"; assets = $assets } | ConvertTo-Json -Compress
        }
        default { throw "Unexpected gh command: $args" }
    }
}

& (Join-Path (Get-Location) 'scripts/release.ps1') @PSBoundParameters
exit $LASTEXITCODE

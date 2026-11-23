$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runner = $null
$runnerPrefix = @()

if (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) {
    $runner = (Get-Command pnpm.cmd).Source
} elseif (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
    $runner = (Get-Command npm.cmd).Source
} else {
    $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    $bundledPnpm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs'
    if ((Test-Path -LiteralPath $bundledNode) -and (Test-Path -LiteralPath $bundledPnpm)) {
        $runner = $bundledNode
        $runnerPrefix = @($bundledPnpm)
        $env:PATH = (Split-Path -Parent $bundledNode) + ';' + $env:PATH
    }
}

if (-not $runner) { throw 'Please install the Node.js LTS Windows installer (including npm), then reopen this launcher.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\vite'))) {
    & $runner @runnerPrefix install
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check the network and try again.' }
}
Write-Host 'CS Demo Master: http://127.0.0.1:5173' -ForegroundColor Green
& $runner @runnerPrefix run dev
exit $LASTEXITCODE

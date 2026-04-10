$server = Start-Process node -ArgumentList "demo\http\node_http.mjs" -PassThru -NoNewWindow

Register-EngineEvent PowerShell.Exiting -Action {
    if (!$server.HasExited) {
        Stop-Process -Id $server.Id -Force
    }
} | Out-Null

Start-Sleep 2
Write-Host "test node:http"
k6 --quiet run demo\node_http\k6.ts
Stop-Process -Id $server.Id -Force

$server = Start-Process bun -ArgumentList "demo\http\bun.mjs" -PassThru -NoNewWindow
Write-Host "test node:http"
Start-Sleep 2
k6 --quiet run demo\node_http\k6.ts
Stop-Process -Id $server.Id -Force

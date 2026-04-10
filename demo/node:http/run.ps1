$server = Start-Process node -ArgumentList "demo\node:http\server.mjs" -PassThru -NoNewWindow

Register-EngineEvent PowerShell.Exiting -Action {
    if (!$server.HasExited) {
        Stop-Process -Id $server.Id -Force
    }
} | Out-Null

Start-Sleep 2
k6 run demo\node:http\k6.ts

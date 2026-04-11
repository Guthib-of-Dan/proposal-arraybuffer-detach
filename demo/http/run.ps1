$global:container = ""

function Cleanup {
    Write-Host "Cleaning up..."
    if ($global:container) {
        docker stop $global:container | Out-Null
    }
}

# Ctrl+C handler
$handler = {
    param($sender, $eventArgs)
    $eventArgs.Cancel = $true
    Cleanup
    exit 1
}
[Console]::CancelKeyPress += $handler

function Run-Test($name, $image, $port) {
    Write-Host "test $name"

    $global:container = docker run -d `
        --rm `
        --memory=300m `
        --memory-swap=300m `
        -p ${port}:8080`
        $image

    Start-Sleep 2

    k6 --quiet run demo\http\k6.ts

    docker stop -t 0 $global:container | Out-Null
    docker wait $global:container | Out-Null
    $global:container = ""
}

try {
    Run-Test "node:http" "bench-node" 8080
    Run-Test "bun (equal results expected for .transfer(0))" "bench-bun" 8080
    Run-Test "deno (equal results expected for .transfer(0))" "bench-deno" 8080
}
finally {
    Cleanup
}

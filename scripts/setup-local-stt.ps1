<#
setup-local-stt.ps1 — prepara la transcripción de voz (Vosk) para desarrollo en Windows.

Crea un entorno Python en vosk\.venv, instala vosk\requirements.txt, descarga el modelo
en models\ si falta y arranca el servidor (vosk\server.py). En Docker no hace falta:
la imagen ya lo trae todo.

Uso (desde la raíz del repo):
  .\scripts\setup-local-stt.ps1 [-Port 5001] [-NoStart]
#>

param(
    [string]$ModelUrl = 'https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip',
    [int]$Port = 5001,
    [switch]$NoStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "No se encontró 'python' en el PATH. Instala Python 3.10+." -ForegroundColor Red
    exit 1
}

# Entorno Python propio del servidor Vosk
$venvDir = Join-Path $repoRoot 'vosk\.venv'
$venvPython = Join-Path $venvDir 'Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    Write-Host "Creando entorno Python en $venvDir"
    python -m venv $venvDir
}
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install -r (Join-Path $repoRoot 'vosk\requirements.txt') --quiet

# Modelo (se descarga y descomprime una vez; el .zip se borra)
$modelsDir = Join-Path $repoRoot 'models'
$modelName = [IO.Path]::GetFileNameWithoutExtension((Split-Path $ModelUrl -Leaf))
$modelPath = Join-Path $modelsDir $modelName
if (-not (Test-Path $modelPath)) {
    New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null
    $zip = Join-Path $env:TEMP "$modelName.zip"
    Write-Host "Descargando modelo $modelName..."
    Invoke-WebRequest -Uri $ModelUrl -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $modelsDir -Force
    Remove-Item $zip
}
Write-Host "Modelo: $modelPath" -ForegroundColor Green

if ($NoStart) { exit 0 }

Write-Host "Arrancando vosk\server.py en el puerto $Port (Ctrl+C para parar)"
& $venvPython (Join-Path $repoRoot 'vosk\server.py') --model $modelPath --port $Port

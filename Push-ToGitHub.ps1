<#
  Публикация кода на GitHub.
  Запуск:  powershell -ExecutionPolicy Bypass -File Push-ToGitHub.ps1 -RepoUrl https://github.com/ЛОГИН/shadevis-api.git

  Репозиторий создай заранее (пустой, без README): https://github.com/new
  При первом push откроется окно входа в GitHub (Git Credential Manager).
#>
param(
  [Parameter(Mandatory=$true)][string]$RepoUrl
)

$ErrorActionPreference='Stop'
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (!$git) { $git = 'C:\Program Files\Git\cmd\git.exe' }
if (!(Test-Path $git)) { throw 'git не найден — установи Git for Windows' }

Set-Location $PSScriptRoot

if (!(Test-Path (Join-Path $PSScriptRoot '.git'))) {
  & $git init | Out-Host
  & $git config user.name 'ShadeVisuals' | Out-Host
  & $git config user.email 'shadevis@local' | Out-Host
  & $git add . | Out-Host
  & $git commit -m 'ShadeVisuals API for Render' | Out-Host
  & $git branch -M main | Out-Host
}

& $git remote remove origin 2>$null
& $git remote add origin $RepoUrl
Write-Host "Пушу в $RepoUrl ..."
& $git push -u origin main
if ($LASTEXITCODE -ne 0) { throw 'push не удался (проверь вход в GitHub)' }

Write-Host ''
Write-Host 'Готово. Дальше в Render:' -ForegroundColor Green
Write-Host '  1) https://dashboard.render.com/blueprints  ->  New Blueprint Instance'
Write-Host '  2) выбери репозиторий, Apply - Render создаст сервис и Postgres сам'
Write-Host '  3) открой https://<адрес>.onrender.com/api/launcher - должно быть "backend":"postgres"'

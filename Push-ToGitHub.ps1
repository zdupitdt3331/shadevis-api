<#
  Публикация кода на GitHub.
  Варианты запуска:
     powershell -ExecutionPolicy Bypass -File Push-ToGitHub.ps1
        (спросит ссылку на репозиторий)
     powershell -ExecutionPolicy Bypass -File Push-ToGitHub.ps1 -RepoUrl https://github.com/ЛОГИН/shadevis-api.git
     powershell -ExecutionPolicy Bypass -File Push-ToGitHub.ps1 https://github.com/ЛОГИН/shadevis-api.git
  Репозиторий создай заранее (пустой, без README): https://github.com/new
#>
param(
  [Parameter(Position=0)][string]$RepoUrl
)

$ErrorActionPreference='Stop'
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (!$git) { $git = 'C:\Program Files\Git\cmd\git.exe' }
if (!(Test-Path $git)) { throw 'git не найден — установи Git for Windows' }

Set-Location $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($RepoUrl)) {
  $file = Join-Path $PSScriptRoot 'repo-url.txt'
  if (Test-Path $file) {
    $RepoUrl = (Get-Content $file -Raw).Trim()
  }
}
if ([string]::IsNullOrWhiteSpace($RepoUrl)) {
  $RepoUrl = (Read-Host 'Вставь ссылку на репозиторий (https://github.com/ЛОГИН/shadevis-api.git)').Trim()
}
if ([string]::IsNullOrWhiteSpace($RepoUrl)) { throw 'Ссылка на репозиторий не указана' }
if (!$RepoUrl.EndsWith('.git')) { $RepoUrl = $RepoUrl.TrimEnd('/') + '.git' }

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
Write-Host "Пушу в $RepoUrl ..." -ForegroundColor Cyan
& $git push -u origin main
if ($LASTEXITCODE -ne 0) { throw 'push не удался (проверь вход в GitHub)' }

Write-Host ''
Write-Host 'Готово. Дальше в Render:' -ForegroundColor Green
Write-Host '  1) https://dashboard.render.com/blueprints  ->  New Blueprint Instance'
Write-Host '  2) выбери репозиторий, Apply - Render создаст сервис и Postgres сам'
Write-Host '  3) открой https://<адрес>.onrender.com/api/launcher - должно быть "backend":"postgres"'

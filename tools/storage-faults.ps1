$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
  throw 'Run storage fault injection only on a disposable GitHub Actions Windows runner.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'VHD verification requires the disposable runner administrator account.'
}
$parent = (Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path
$token = [guid]::NewGuid().ToString()
$fixture = Join-Path $parent "reminder-fault-$token"
$image = Join-Path $fixture 'storage.vhd'
$letter = @('R','S','T','U','V','W','X','Y','Z') | Where-Object {
  -not (Test-Path -LiteralPath "${_}:\") -and -not (Get-Volume -DriveLetter $_ -ErrorAction SilentlyContinue)
} | Select-Object -First 1
if (-not $letter) { throw 'No unused drive letter available.' }
New-Item -ItemType Directory -Path $fixture | Out-Null
if ((Split-Path -Parent ([IO.Path]::GetFullPath($image))) -ne $fixture -or (Test-Path -LiteralPath $image)) {
  throw 'Unexpected VHD target.'
}
try {
  $setup = Join-Path $fixture 'setup.txt'
  @"
create vdisk file="$image" maximum=64 type=fixed
select vdisk file="$image"
attach vdisk
create partition primary
format fs=ntfs quick label=ReminderFault
assign letter=$letter
"@ | Set-Content -LiteralPath $setup -Encoding ascii
  & diskpart /s $setup
  if ($LASTEXITCODE -ne 0) { throw 'VHD setup failed.' }
  $volume = Get-Volume -DriveLetter $letter
  if ($volume.FileSystemLabel -ne 'ReminderFault' -or $volume.Size -gt 64MB -or $volume.Size -lt 20MB) {
    throw 'Unexpected test volume identity or size.'
  }
  $volumeRoot = "${letter}:\"
  Set-Content -LiteralPath (Join-Path $volumeRoot '.reminder-fault-marker') -Value $token -NoNewline
  & node (Join-Path $PSScriptRoot 'storage-faults.mjs') $volumeRoot $token $identity.User.Value
  if ($LASTEXITCODE -ne 0) { throw 'Storage fault assertions failed.' }
} finally {
  if (Test-Path -LiteralPath $image) {
    $detach = Join-Path $fixture 'detach.txt'
    "select vdisk file=`"$image`"`ndetach vdisk" | Set-Content -LiteralPath $detach -Encoding ascii
    & diskpart /s $detach
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not detach test VHD: $image" }
  }
  # Retain the small test VHD/logs until the disposable runner is destroyed.
  # Never format, delete or select a physical disk.
}

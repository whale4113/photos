param([ValidateSet('dev','check','test','build','debug')][string]$Action='dev')
$ErrorActionPreference='Stop'
$project=$PSScriptRoot
$toolRoot=Join-Path (Split-Path $project) '.tools'
if(Test-Path -LiteralPath (Join-Path $toolRoot 'cargo\bin\cargo.exe')){
 $env:CARGO_HOME=Join-Path $toolRoot 'cargo';$env:RUSTUP_HOME=Join-Path $toolRoot 'rustup';$env:PATH=(Join-Path $toolRoot 'cargo\bin')+';'+$env:PATH
}
$setup=Join-Path $toolRoot 'msvc\setup_x64.bat'
if(Test-Path -LiteralPath $setup){
 $envLines=& cmd.exe /d /c "call `"$setup`" >nul && set"
 foreach($line in $envLines){if($line -match '^(PATH|INCLUDE|LIB|LIBPATH|VCToolsInstallDir|VCToolsVersion|WindowsSdkDir|WindowsSDKVersion|VSCMD_ARG_HOST_ARCH|VSCMD_ARG_TGT_ARCH)=(.*)$'){[Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process')}}
}
Set-Location -LiteralPath $project
switch($Action){
 'dev' {npm run tauri -- dev}
 'check' {cargo check --manifest-path src-tauri/Cargo.toml}
 'test' {cargo test --manifest-path src-tauri/Cargo.toml}
 'build' {npm run tauri -- build}
 'debug' {npm run build;if($LASTEXITCODE -eq 0){cargo build --manifest-path src-tauri/Cargo.toml}}
}
exit $LASTEXITCODE

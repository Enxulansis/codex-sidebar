param([switch]$Probe,[switch]$LibraryOnly)
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)

function Write-DictationFrame($Value){[Console]::WriteLine(($Value|ConvertTo-Json -Compress -Depth 6));[Console]::Out.Flush()}
function Get-DictationRecognizers {
 Add-Type -AssemblyName System.Speech
 @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object { @{id=$_.Id;name=$_.Name;culture=$_.Culture.Name} })
}

# The event queue is drained on this runspace. No PowerShell callback runs on a SAPI worker thread.
# LibraryOnly exposes this same pump to a synthetic .NET event source, without creating a speech engine.
function Invoke-DictationLoop($Engine,$Reader,[int]$MaximumMilliseconds=120000) {
 $ids=@('dictation.text','dictation.completed');$stopRequested=$false;$sequence=0;$characters=0;$stopAt=$null
 $watch=[Diagnostics.Stopwatch]::StartNew()
 try {
  Register-ObjectEvent -InputObject $Engine -EventName SpeechRecognized -SourceIdentifier $ids[0] | Out-Null
  Register-ObjectEvent -InputObject $Engine -EventName RecognizeCompleted -SourceIdentifier $ids[1] | Out-Null
  $control=$Reader.ReadLineAsync()
  if($control.IsCompleted){
   $early=$control.GetAwaiter().GetResult()
   if($null -eq $early -or ($early.Length -le 4096 -and ($early|ConvertFrom-Json).command -in @('stop','cancel'))){Write-DictationFrame @{phase='cancelled'};return}
   throw 'Invalid pre-start control'
  }
  # Microphone access occurs only inside this explicitly invoked start path, after language validation.
  $Engine.SetInputToDefaultAudioDevice()
  if($control.IsCompleted){$Engine.RecognizeAsyncCancel();Write-DictationFrame @{phase='cancelled'};return}
  $Engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  Write-DictationFrame @{phase='listening'}
  while($true){
   if($control.IsCompleted){
    $line=$control.GetAwaiter().GetResult()
    if($null -eq $line){$Engine.RecognizeAsyncCancel();Write-DictationFrame @{phase='cancelled'};return}
    if($line.Length -gt 4096){throw 'Invalid dictation control'}
    $command=$line|ConvertFrom-Json
    if($command.command -eq 'cancel'){$Engine.RecognizeAsyncCancel();Write-DictationFrame @{phase='cancelled'};return}
    if($command.command -ne 'stop') {throw 'Invalid dictation control'}
    if(-not $stopRequested){$stopRequested=$true;$stopAt=$watch.ElapsedMilliseconds+5000;$Engine.RecognizeAsyncStop();Write-DictationFrame @{phase='stopping'}}
    $control=$Reader.ReadLineAsync()
   }
   $events=@(Get-Event | Where-Object {$_.SourceIdentifier -in $ids} | Sort-Object EventIdentifier)
   foreach($event in $events){
    try {
     $argsValue=$event.SourceEventArgs
     if($event.SourceIdentifier -eq $ids[0]){
      $text=$argsValue.Result.Text
      if($text -isnot [string] -or $text.Length -gt 4000 -or $text -match '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]'){throw 'Invalid dictation text'}
      if($text.Length){$characters+=$text.Length;$sequence++;if($characters -gt 20000 -or $sequence -gt 512){throw 'Dictation limit'};Write-DictationFrame @{phase='text';sequence=$sequence;text=$text}}
     }else{
      if($argsValue.Error){throw 'Recognition failed'}
      # RecognizeAsyncStop also reports Cancelled=true. Explicit command intent owns cancellation.
      if($argsValue.Cancelled -and -not $stopRequested){throw 'Recognition interrupted'}
      Write-DictationFrame @{phase='ended'};return
     }
    }finally{Remove-Event -EventIdentifier $event.EventIdentifier -ErrorAction SilentlyContinue}
   }
   if($watch.ElapsedMilliseconds -ge $MaximumMilliseconds -and -not $stopRequested){$stopRequested=$true;$stopAt=$watch.ElapsedMilliseconds+5000;$Engine.RecognizeAsyncStop();Write-DictationFrame @{phase='stopping'}}
   if($null -ne $stopAt -and $watch.ElapsedMilliseconds -ge $stopAt){throw 'Recognition stop timeout'}
   Start-Sleep -Milliseconds 25
  }
 }finally{
  foreach($id in $ids){Unregister-Event -SourceIdentifier $id -ErrorAction SilentlyContinue;Get-Event -SourceIdentifier $id -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue}
  try{$Engine.RecognizeAsyncCancel()}catch{}
 }
}

if($LibraryOnly){return}
$engine=$null;$reader=$null
try {
 $recognizers=@(Get-DictationRecognizers)
 if($Probe){Write-DictationFrame @{protocol=1;recognizers=$recognizers;microphoneOpened=$false};exit 0}
 $reader=[IO.StreamReader]::new([Console]::OpenStandardInput(),[Text.UTF8Encoding]::new($false))
 $line=$reader.ReadLine();if($null -eq $line){exit 0};if($line.Length -gt 4096){throw 'Invalid start'}
 $start=$line|ConvertFrom-Json
 if($start.command -ne 'start' -or $start.recognizerId -isnot [string] -or -not ($recognizers | Where-Object {$_.id -ceq $start.recognizerId})){throw 'Unknown recognizer'}
 $engine=[System.Speech.Recognition.SpeechRecognitionEngine]::new($start.recognizerId)
 $engine.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new())
 Invoke-DictationLoop $engine $reader
}catch {
 if($Probe){Write-DictationFrame @{protocol=1;recognizers=@();microphoneOpened=$false;error='本机识别语言读取失败'};exit 1}
 Write-DictationFrame @{phase='error';error='本地听写未完成，请核对Windows麦克风权限、设备和识别语言'};exit 1
}finally{if($engine){$engine.Dispose()}}

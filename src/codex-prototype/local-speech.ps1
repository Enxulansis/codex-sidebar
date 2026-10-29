param([switch]$Probe,[switch]$Verify)
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$voice=$null;$voices=$null;$stream=$null
function Emit($value){[Console]::WriteLine(($value|ConvertTo-Json -Compress));[Console]::Out.Flush()}
try {
 $voice=[Activator]::CreateInstance([type]::GetTypeFromProgID('SAPI.SpVoice'))
 $voices=$voice.GetVoices()
 if($voices.Count -lt 1){throw '本机没有可用语音'}
 if($Probe){Emit @{available=$true;voices=$voices.Count};exit}
 $reader=[IO.StreamReader]::new([Console]::OpenStandardInput(),[Text.UTF8Encoding]::new($false))
 $inputText=$reader.ReadLine()|ConvertFrom-Json
 if($inputText -isnot [string] -or $inputText.Length -lt 1 -or $inputText.Length -gt 100000){throw '朗读正文无效或超过100000字符'}
 if($inputText -match '[\u4e00-\u9fff]'){
  for($i=0;$i -lt $voices.Count;$i++){$token=$voices.Item($i);if($token.GetAttribute('Language') -match '(?i)(^|;)804(;|$)'){$voice.Voice=$token;break}}
 }
 if($Verify){$stream=[Activator]::CreateInstance([type]::GetTypeFromProgID('SAPI.SpMemoryStream'));$stream.Format.Type=22;$voice.AudioOutputStream=$stream}
 # SPF_ASYNC | SPF_IS_NOT_XML: public text is never parsed as SSML or a resource reference.
 [void]$voice.Speak($inputText,17)
 Emit @{phase='started';local=$true}
 $stop=$reader.ReadLineAsync()
 while(-not $voice.WaitUntilDone(50)){
  if($stop.IsCompleted){[void]$voice.Speak('',3);Emit @{phase='stopped';local=$true};exit}
 }
 Emit @{phase='ended';local=$true;verifiedBytes=$(if($Verify){$stream.GetData().Length}else{0})}
}catch{Emit @{phase='error';error=$_.Exception.Message};exit 1}
finally{
 if($voice){try{[void]$voice.Speak('',3)}catch{};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($voice)}
 if($stream){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($stream)}
 if($voices){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($voices)}
}

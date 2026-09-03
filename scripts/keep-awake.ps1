# Holds the machine awake for as long as this process lives, then lets it sleep again.
#
# This changes nothing permanent: it asks Windows for the same "I am busy, do not
# suspend" state that a video player uses, and Windows drops the request the moment the
# process exits. No power-plan setting is edited, so nothing needs restoring afterwards.
#
# The display is deliberately left free to switch off. Only the system is held up.

Add-Type -Namespace Power -Name Util -MemberDefinition @'
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
'@

$ES_CONTINUOUS = [uint32]0x80000000
$ES_SYSTEM_REQUIRED = [uint32]0x00000001

[Power.Util]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED) | Out-Null
Write-Output "keep-awake: holding the system awake (pid $PID). Close this window to release."

try {
    while ($true) { Start-Sleep -Seconds 60 }
}
finally {
    [Power.Util]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
}

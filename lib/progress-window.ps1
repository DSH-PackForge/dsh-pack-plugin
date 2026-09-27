# DSH PackForge profile-switch progress window (packaged-build replacement for the electron popup).
#
# Spawned by the migration helper as:
#   powershell -NoProfile -File progress-window.ps1 -ProgressFile <path>
# It polls progress.json and renders the step timeline; closes itself when phase is done/failed.
#
# MUST run under Windows PowerShell 5.1 (powershell.exe), which is STA and can show WPF windows.
# pwsh (PowerShell 7+) is MTA and will throw on window creation.
#
# Keep this file pure ASCII: Windows PowerShell 5.1 reads .ps1 in the ANSI codepage, so any
# non-ASCII literal (Chinese comments, symbols) would garble. Labels come from progress.json
# (read as UTF-8), so nothing non-ASCII is hardcoded here.
param([Parameter(Mandatory = $true)][string]$ProgressFile)

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore

function Read-Progress {
    if (-not (Test-Path -LiteralPath $ProgressFile)) { return $null }
    try {
        $raw = [System.IO.File]::ReadAllText($ProgressFile)
        return ($raw | ConvertFrom-Json)
    } catch { return $null }
}

function New-Brush([string]$hex) {
    return ([System.Windows.Media.BrushConverter]::new()).ConvertFromString($hex)
}

$window = New-Object System.Windows.Window
$window.Title = 'DSH PackForge'
$window.WindowStyle = [System.Windows.WindowStyle]::None
$window.ResizeMode = [System.Windows.ResizeMode]::NoResize
$window.Topmost = $true
$window.ShowInTaskbar = $false
$window.Width = 380
$window.Height = 272
$window.Background = New-Brush '#1e1f24'
$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual
$wa = [System.Windows.SystemParameters]::WorkArea
$window.Left = $wa.Right - $window.Width - 20
$window.Top = $wa.Bottom - $window.Height - 20

$root = New-Object System.Windows.Controls.StackPanel
$root.Margin = New-Object System.Windows.Thickness(18)

$title = New-Object System.Windows.Controls.TextBlock
$title.FontSize = 14
$title.FontWeight = 'SemiBold'
$title.Foreground = New-Brush '#e6e6ea'
$title.Text = 'DSH PackForge'
$root.AddChild($title) | Out-Null

$subtitle = New-Object System.Windows.Controls.TextBlock
$subtitle.FontSize = 11
$subtitle.Foreground = New-Brush '#8b8c95'
$subtitle.Margin = New-Object System.Windows.Thickness(0, 2, 0, 0)
$root.AddChild($subtitle) | Out-Null

$stepsPanel = New-Object System.Windows.Controls.StackPanel
$stepsPanel.Margin = New-Object System.Windows.Thickness(0, 12, 0, 0)
$root.AddChild($stepsPanel) | Out-Null

$hint = New-Object System.Windows.Controls.TextBlock
$hint.FontSize = 11
$hint.Foreground = New-Brush '#8b8c95'
$hint.TextWrapping = [System.Windows.TextWrapping]::Wrap
$hint.Margin = New-Object System.Windows.Thickness(0, 12, 0, 0)
$root.AddChild($hint) | Out-Null

$window.Content = $root

$statusGlyph = @{
    pending = ' '
    running = [char]0x25D1
    done    = [char]0x25C9
    failed  = [char]0x00D7
}
$statusColor = @{
    pending = '#5a5b63'
    running = '#6ab7ff'
    done    = '#2ea44f'
    failed  = '#d3383a'
}

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [System.TimeSpan]::FromMilliseconds(200)
$timer.Add_Tick({
    $p = Read-Progress
    if ($null -eq $p) { return }
    $subtitle.Text = "$($p.from) -> $($p.to)"
    if ($null -ne $p.hint) { $hint.Text = [string]$p.hint } else { $hint.Text = '' }
    $stepsPanel.Children.Clear()
    foreach ($s in @($p.steps)) {
        $line = New-Object System.Windows.Controls.TextBlock
        $glyph = $statusGlyph[$s.status]
        if ($null -eq $glyph) { $glyph = ' ' }
        $line.Text = "$glyph  $($s.label)"
        $line.FontSize = 13
        $line.Margin = New-Object System.Windows.Thickness(0, 4, 0, 0)
        $col = $statusColor[$s.status]
        if ($null -eq $col) { $col = '#9a9ba3' }
        $line.Foreground = New-Brush $col
        $stepsPanel.AddChild($line) | Out-Null
    }
    if ($p.phase -eq 'done' -or $p.phase -eq 'failed') {
        $timer.Stop()
        Start-Sleep -Milliseconds 700
        $window.Close()
    }
})
$timer.Start()

$window.ShowDialog() | Out-Null

# Draw the "holo" desktop-pet UI set (bubble.png / input.png / button.png) as nine-slice PNGs:
# a dark glass fill, a 6 px cyan edge, corner brackets that survive the corner slices, and a soft
# inner glow. Vector-drawn on purpose: crisp at any DPI, no model artefacts.
#
# Geometry is made for theme.slice = 10 (% of the short side): on 512 px that is a 51 px corner
# slice, so the brackets (44 px) sit inside it and the edges keep their 6 px at any bubble size.
# The middle slice is flat fill only — anything drawn there would stretch.
# The button is dark glass with a gold edge, so the light label ink (theme.text) stays readable
# (a gold fill under light ink measured 1.5:1).
param([string]$Out = "$env:USERPROFILE\.dsh\pets\_ui-skins\holo")
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $Out | Out-Null
function Draw-Part {
  param([string]$File, [int]$W, [int]$H, [System.Drawing.Color]$Fill, [System.Drawing.Color]$Edge, [System.Drawing.Color]$Bracket, [int]$BracketLen, [bool]$Glow)
  $bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $inset = 4
  $rect = New-Object System.Drawing.Rectangle($inset, $inset, ($W - 2 * $inset - 1), ($H - 2 * $inset - 1))
  # glass fill
  $g.FillRectangle((New-Object System.Drawing.SolidBrush($Fill)), $rect)
  # inner glow: fading inset rectangles just inside the edge
  if ($Glow) {
    for ($i = 4; $i -le 12; $i++) {
      $a = [int](30 - ($i - 3) * 3)
      $pen = New-Object System.Drawing.Pen((([System.Drawing.Color]::FromArgb($a, $Edge.R, $Edge.G, $Edge.B))), 1)
      $g.DrawRectangle($pen, ($rect.X + $i), ($rect.Y + $i), ($rect.Width - 2 * $i), ($rect.Height - 2 * $i))
      $pen.Dispose()
    }
  }
  # the edge: 6 px, centred on the rectangle line (3 px inside, 3 px outside → the 4 px inset holds it)
  $edgePen = New-Object System.Drawing.Pen($Edge, 6)
  $edgePen.Alignment = [System.Drawing.Drawing2D.PenAlignment]::Center
  $g.DrawRectangle($edgePen, $rect)
  # corner brackets (thicker, brighter): 8 px, BracketLen long, inside the 10 % corner slices
  $bp = New-Object System.Drawing.Pen($Bracket, 8)
  $bp.StartCap = [System.Drawing.Drawing2D.LineCap]::Square; $bp.EndCap = [System.Drawing.Drawing2D.LineCap]::Square
  $L = $BracketLen; $x0 = $rect.X; $y0 = $rect.Y; $x1 = $rect.Right; $y1 = $rect.Bottom
  $g.DrawLine($bp, $x0, $y0, ($x0 + $L), $y0); $g.DrawLine($bp, $x0, $y0, $x0, ($y0 + $L))
  $g.DrawLine($bp, $x1, $y0, ($x1 - $L), $y0); $g.DrawLine($bp, $x1, $y0, $x1, ($y0 + $L))
  $g.DrawLine($bp, $x0, $y1, ($x0 + $L), $y1); $g.DrawLine($bp, $x0, $y1, $x0, ($y1 - $L))
  $g.DrawLine($bp, $x1, $y1, ($x1 - $L), $y1); $g.DrawLine($bp, $x1, $y1, $x1, ($y1 - $L))
  $g.Dispose()
  $bmp.Save($File, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
$cyanBright = [System.Drawing.Color]::FromArgb(255, 120, 240, 255)
$gold = [System.Drawing.Color]::FromArgb(255, 255, 214, 10)
$glass = [System.Drawing.Color]::FromArgb(214, 8, 14, 21)
$glassDeep = [System.Drawing.Color]::FromArgb(226, 6, 11, 17)
$glassButton = [System.Drawing.Color]::FromArgb(232, 10, 18, 25)
Draw-Part -File "$Out\bubble.png" -W 512 -H 512 -Fill $glass -Edge $cyanBright -Bracket $cyanBright -BracketLen 44 -Glow $true
Draw-Part -File "$Out\input.png" -W 512 -H 256 -Fill $glassDeep -Edge $cyanBright -Bracket $cyanBright -BracketLen 22 -Glow $true
Draw-Part -File "$Out\button.png" -W 256 -H 256 -Fill $glassButton -Edge $gold -Bracket $gold -BracketLen 22 -Glow $false
Get-ChildItem $Out | ForEach-Object { "$($_.Name) $($_.Length) bytes" }

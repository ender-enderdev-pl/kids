Add-Type -AssemblyName System.Drawing

foreach ($size in 192, 512) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $background = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#163c32'))
    $disc = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#254e3d'))
    $bow = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#e8cb78'), 25)
    $string = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#d6dfb3'), 14)
    $arrow = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#e6edd0'), 16)

    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.ScaleTransform($size / 512.0, $size / 512.0)
        $graphics.FillRectangle($background, 0, 0, 512, 512)
        $graphics.FillEllipse($disc, 80, 80, 352, 352)

        foreach ($pen in @($bow, $string, $arrow)) {
            $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
        }

        $graphics.DrawBezier($bow, 171, 111, 399, 124, 399, 388, 171, 401)
        $graphics.DrawLine($string, 171, 111, 248, 256)
        $graphics.DrawLine($string, 248, 256, 171, 401)
        $graphics.DrawLine($arrow, 99, 256, 409, 256)
        $graphics.DrawLine($arrow, 361, 211, 409, 256)
        $graphics.DrawLine($arrow, 409, 256, 361, 301)

        $bitmap.Save((Join-Path $PSScriptRoot "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $arrow.Dispose()
        $string.Dispose()
        $bow.Dispose()
        $disc.Dispose()
        $background.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

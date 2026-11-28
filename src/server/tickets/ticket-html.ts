/**
 * Plantilla HTML del TICKET DE COMPRA (diseño FlujoTV) renderizada en el
 * servidor para capturarla como IMAGEN PNG con Chrome headless. Es la MISMA
 * pieza de diseño que `assets/ticket-flujotv.html` (fuente visual única),
 * adaptada para captura:
 *
 * - Sin JavaScript: los datos se inyectan aquí (HTML-escapeados).
 * - Página de tamaño EXACTO (`@page`) y tarjeta de altura fija con la ola
 *   anclada al fondo: la captura sale siempre del mismo marco, sin importar
 *   el largo de los valores (los valores van en una sola línea con elipsis).
 * - Logo Flujo incrustado (SVG inline): sin dependencias de archivos externos.
 *
 * Google Fonts (Poppins + Inter) se cargan por link; Chrome las descarga al
 * renderizar. Si la red falla, degrada a la fuente del sistema sin romper.
 */

/** SVG del logo Flujo (assets/flujo-logo.svg), incrustado para que el
 * template sea autónomo. Se rellena en build del módulo. */
const LOGO_SVG = `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" style="display: block;" viewBox="0 0 2048 1039" width="800" height="406" preserveAspectRatio="none">
<defs>
	<linearGradient id="Gradient1" gradientUnits="userSpaceOnUse" x1="1405.16" y1="306.509" x2="1648.91" y2="85.3172">
		<stop class="stop0" offset="0" stop-opacity="1" stop-color="rgb(210,57,5)"/>
		<stop class="stop1" offset="1" stop-opacity="1" stop-color="rgb(252,147,7)"/>
	</linearGradient>
</defs>
<path transform="translate(0,0)" fill="rgb(222,103,4)" d="M 1052.15 61.1834 C 1086.51 56.9389 1131.07 57.4566 1162.94 71.706 C 1247.68 108.643 1263.45 184.814 1260.32 269.252 C 1266.11 269.755 1271.7 269.902 1277.52 269.879 C 1323.19 269.705 1369.02 271.469 1414.63 268.811 C 1415.07 269.182 1415.51 269.552 1415.94 269.923 C 1417.53 277.979 1405.32 301.194 1406.18 318.904 C 1407.02 336.061 1416.46 355.011 1429.23 366.439 C 1442.54 378.357 1461.69 385.13 1479.53 383.009 C 1503.64 380.143 1580.42 336.462 1606.5 323.116 C 1630.47 310.844 1654.81 299.347 1678.89 287.299 C 1690.76 281.354 1704.43 269.915 1717.99 269.385 C 1733.95 268.762 1750.33 278.299 1761.76 288.755 C 1778.71 304.276 1786.27 322.48 1787.14 345.297 C 1788.34 377 1787.33 408.998 1787.19 440.728 L 1787.28 574.878 L 1787.55 653.628 C 1787.6 687.271 1791.52 716.556 1766.97 742.871 C 1754.94 755.774 1738.89 764.212 1721.44 766.804 C 1706.58 769.047 1666.2 767.995 1649.84 767.916 L 1524.32 767.551 L 1200.86 767.825 L 1074 767.841 C 1050.74 767.789 1023.92 766.94 1001.12 767.758 C 1006.33 756.264 1031.02 726.788 1038.95 716.452 C 1047.07 705.869 1107.2 622.749 1108.62 613.084 C 1103.02 613.318 1082.24 641.89 1077.53 647.576 C 959.198 790.591 804.81 917.083 628.022 978.777 C 520.258 1016.38 371.602 1024.05 315.005 903.243 C 293.384 857.093 294.792 817.718 294.873 768.929 C 288.935 769.006 282.996 769.031 277.057 769.004 C 235.441 768.649 199.143 753.444 188.709 707.413 C 185.723 694.239 186.953 673.784 186.935 659.92 L 186.87 591.325 L 187.051 441.05 C 187.053 411.534 186.932 382.088 186.993 352.47 C 186.683 329.014 192.712 308.158 209.901 291.499 C 236.155 266.055 266.712 269.228 299.982 269.715 C 320.183 270.038 340.386 270.189 360.59 270.168 L 503.249 270.263 C 521.199 270.177 540.868 268.652 558.035 268.987 C 551.879 280.914 538.484 292.782 530.751 303.311 C 512.545 328.1 485.799 364.855 475.373 393.17 C 485.562 385.002 511.438 353.141 521.776 341.427 C 544.603 315.898 568.444 291.294 593.24 267.673 C 620.642 242.246 649.225 218.123 678.895 195.383 C 703.7 176.568 728.392 164.889 745.64 137.139 C 762.757 109.601 781.403 90.1946 816.434 94.091 C 853.316 98.1932 872.09 130.439 867.988 165.081 C 861.591 213.298 810.668 214.2 775.514 229.743 C 750.814 240.465 732.385 252.427 710.964 268.858 C 735.5 270.69 765.526 270.113 790.45 270.232 L 948.544 270.054 L 1126.29 270.172 C 1155.15 270.113 1194.24 271.153 1222.41 269.138 C 1223.03 266.543 1223.55 263.926 1223.98 261.293 C 1232.44 209.212 1223.81 145.76 1183.65 107.212 C 1156.13 80.8064 1110.03 69.315 1073.08 68.3065 C 1056.26 67.8476 1042.53 71.0067 1024.93 68.2164 C 1032.19 65.8914 1044.89 62.4554 1052.15 61.1834 z M 875.835 768.268 C 837.147 770.278 795.707 768.49 756.859 768.011 C 722.254 767.585 687.464 767.709 652.841 767.645 L 463.847 767.964 C 434.815 768.036 401.674 768.93 372.987 768.143 C 364.584 771.732 365.158 785.436 364.477 793.217 C 359.54 849.592 380.76 910.315 438.351 929.969 C 457.663 936.559 475.289 938.245 495.747 938.081 C 571.061 940.521 641.82 911.113 708.875 880.058 C 730.961 869.83 750.466 857.38 771.565 845.133 C 795.39 830.328 860.074 787.995 875.835 768.268 z M 1440.74 607.572 C 1441.45 608.312 1442.17 609.04 1442.91 609.757 C 1462.07 628.402 1495.91 624.147 1521.15 624.083 L 1589.7 623.834 C 1611.13 623.56 1626.76 622.769 1642.81 606.312 C 1647.98 600.261 1657.21 590.156 1660.59 583.501 C 1685.53 534.277 1680.72 467.33 1637.58 429.436 C 1623.61 417.161 1610.04 415.648 1591.99 415.814 C 1569.15 416.023 1546.24 416.076 1523.37 416.139 C 1509.54 416.177 1494.42 415.33 1480.67 416.382 C 1426.28 420.548 1405.15 487.832 1409.77 533.876 C 1413.49 564.529 1420.81 585.18 1440.74 607.572 z M 1071.48 475.75 C 1071.61 453.007 1078.78 412.141 1047.58 411.844 C 1039.8 411.77 1031.99 417.248 1026.63 422.351 C 1022.12 452.529 1027.09 488.6 1025.33 519.321 C 1024.66 531.035 1026.6 545.814 1022.65 556.736 C 1011.54 587.495 968.143 590.906 940.941 586.802 C 922.254 583.982 897.362 572.537 894.907 551.929 C 893.637 539.977 893.969 527.636 894.025 515.646 L 894.433 456.488 C 894.622 437.315 897.928 416.069 873.114 411.607 C 872.021 411.414 870.922 411.253 869.818 411.126 C 857.412 413.858 846.067 422.906 847.12 435.845 C 850.861 472.599 842.137 538.006 849.726 571.647 C 862.424 627.935 956.427 639.457 1002.37 626.216 C 1088.29 601.449 1070.12 546.504 1071.48 475.75 z M 1172.6 530.758 C 1159.1 518.206 1147.21 517.174 1134.33 531.522 C 1133.9 531.995 1133.49 532.474 1133.08 532.96 C 1129.41 551.096 1128.34 567.134 1137.71 583.435 C 1151.61 606.397 1170.63 618.778 1199.09 626.29 C 1244.37 638.245 1334.42 628.14 1349.76 573.095 C 1355.85 551.249 1350.38 508.816 1352.31 484.931 C 1352.75 467.98 1352.62 450.823 1352.37 433.885 C 1352.17 419.842 1341.31 411.343 1327.84 411.089 C 1303.46 418.338 1305.95 432.904 1306.41 454.041 C 1306.79 474.745 1306.94 495.451 1306.88 516.158 C 1306.9 546.181 1310.78 572.545 1274.58 583.128 C 1243.28 592.281 1191.08 590.279 1175.96 555.177 C 1174.31 551.338 1173.67 536.006 1172.6 530.758 z M 627.619 500.933 C 627.647 479.746 628.635 446.796 626.524 426.46 C 620.34 418.563 615.09 413.911 604.403 412.469 C 570.774 407.493 580.738 459.984 579.775 480.965 C 577.309 534.703 582.06 621.847 653.976 624.21 C 692.978 625.492 735.681 624.624 774.918 623.833 C 783.295 623.664 791.879 617.129 797.124 610.84 C 799.778 598.114 799.137 591.981 789.693 582.007 C 782.411 579.84 779.584 578.973 771.809 578.48 C 767.508 577.396 753.281 577.83 748.122 577.897 C 724.848 578.749 700.684 577.97 677.522 578.683 C 622.802 580.367 628.518 541.508 627.619 500.933 z M 304.385 612.487 C 319.015 631.079 330.959 634.856 347.094 613.454 C 349.057 601.625 350.648 556.074 349.145 544.354 C 351.015 529.137 348.735 513.509 351.102 498.197 C 353.089 485.339 358.004 474.169 369.935 467.762 C 395.924 453.806 504.028 471.776 522.441 457.823 C 529.878 452.188 530.986 443.631 532.277 435.036 C 528.047 427.143 521.522 418.325 511.688 417.808 C 482.998 416.3 453.975 416.912 425.215 416.84 C 402.843 417.457 379.267 415.333 357.137 418.706 C 342.985 420.863 330.086 432.53 322.302 443.862 C 299.093 483.834 304.229 522.775 303.906 567.287 C 303.8 581.882 303.535 598.068 304.385 612.487 z M 506.695 558.908 C 546.73 555.009 533.32 512.502 508.853 512.517 C 471.564 512.54 431.331 510.651 394.251 512.374 C 386.097 512.926 379.025 513.359 373.051 519.991 C 368.906 524.57 366.741 530.603 367.03 536.772 C 367.664 548.004 374.778 557.35 386.36 558.422 C 400.732 559.753 415.318 559.317 429.763 559.313 C 455.408 559.403 481.052 559.268 506.695 558.908 z"/>
<path transform="translate(0,0)" fill="rgb(222,103,4)" d="M 1625.51 553.026 C 1621.41 561.972 1616.41 569.218 1607.25 573.49 C 1602.44 575.731 1597.23 576.735 1591.98 577.279 C 1575.04 579.036 1492.18 580.405 1480.25 576.002 C 1469.5 572.032 1462.2 562.128 1457.57 552.028 C 1449.66 534.776 1449.34 512.233 1455.95 494.51 C 1460.35 482.682 1468.65 471.279 1480.44 466.031 C 1484.53 464.209 1488.94 463.375 1493.37 462.957 C 1507.98 461.58 1523.15 462.45 1537.84 462.341 C 1555.55 462.211 1574.1 460.952 1591.71 462.754 C 1596.91 463.286 1601.44 464.53 1606.29 466.402 C 1635.54 484.256 1636.35 524.109 1625.51 553.026 z"/>
<path transform="translate(0,0)" fill="rgb(209,89,4)" d="M 1414.52 363.732 C 1420.62 369.843 1422.43 370.984 1419.84 379.368 C 1415.74 379.897 1416.73 380.424 1414.1 378.449 C 1412.81 374.853 1414.4 368.728 1414.52 363.732 z"/>
<path transform="translate(0,0)" fill="url(#Gradient1)" d="M 1746.23 197.893 C 1746.69 206.729 1744.75 215.525 1740.61 223.346 C 1731.17 240.903 1702.91 250.965 1685.7 260.24 C 1654.65 276.976 1622.38 291.848 1590.94 307.81 L 1515.98 346.246 C 1493.69 357.469 1474.86 371.202 1450.03 355.605 C 1392.01 319.175 1467.35 240.37 1465.99 196.156 C 1465.32 174.457 1434.1 122.545 1430.76 97.3412 C 1428.44 83.8877 1426.7 72.4413 1435.04 59.2943 C 1441.65 48.6836 1452.32 41.2476 1464.56 38.7223 C 1487.97 33.7345 1511.17 50.2991 1531.5 60.0042 C 1531.65 60.1103 1531.8 60.2164 1531.96 60.3225 L 1658.63 126.017 C 1678.6 136.131 1699.54 145.287 1718.95 156.403 C 1737.57 167.06 1746.51 175.772 1746.23 197.893 z M 1583.89 158.09 C 1591.79 178.665 1589.9 226.833 1601.81 248.336 C 1608.44 249.318 1612.02 249.847 1618.76 249.867 C 1633.99 238.395 1632.45 225.94 1641.48 213.915 C 1647.92 198.016 1656.6 183.969 1663.93 168.562 C 1665.92 164.376 1667 161.263 1665.33 157.071 L 1663.09 156.199 C 1640.6 159.875 1630.73 214.194 1616.01 226.167 C 1612.16 223.808 1602.62 167.029 1600.46 158.888 C 1594.56 158.062 1589.81 158.13 1583.89 158.09 z M 1543.68 172.129 C 1558.91 171.694 1570.28 175.278 1574.94 158.646 C 1570.1 157.513 1554.54 157.234 1548.78 157.01 C 1535.25 157.803 1503.37 153.992 1494.9 160.78 C 1493.36 164.105 1493.6 162.615 1494.31 166.529 C 1499.08 174.029 1514.49 171.115 1522.63 171.62 C 1522.37 187.804 1510.23 241.563 1511.78 248.021 C 1515.64 250.634 1521.53 249.221 1525.91 248.39 C 1526.99 248.188 1528.08 247.971 1529.16 247.737 C 1534.76 223.116 1537.94 195.3 1543.68 172.129 z"/>
<path transform="translate(0,0)" fill="rgb(249,153,15)" d="M 1531.96 60.3225 L 1658.63 126.017 C 1678.6 136.131 1699.54 145.287 1718.95 156.403 C 1737.57 167.06 1746.51 175.772 1746.23 197.893 C 1743.81 194.708 1743.65 193.659 1743.22 189.693 L 1742.47 189.89 C 1737.14 191.231 1734.5 189.383 1732.06 190.196 C 1726.02 192.21 1718.68 195.695 1712.51 197.639 C 1698.34 202.109 1673.54 203.965 1658.69 203.499 L 1651.5 215.806 C 1650.76 213.364 1652.01 211.497 1652.98 208.6 C 1646.65 208.113 1646.96 210.467 1642.82 214.348 L 1641.48 213.915 C 1647.92 198.016 1656.6 183.969 1663.93 168.562 C 1665.92 164.376 1667 161.263 1665.33 157.071 L 1663.09 156.199 C 1640.6 159.875 1630.73 214.194 1616.01 226.167 C 1612.16 223.808 1602.62 167.029 1600.46 158.888 C 1594.56 158.062 1589.81 158.13 1583.89 158.09 C 1581.01 159.287 1580.18 159.664 1577.02 160.215 L 1574.94 158.646 C 1570.1 157.513 1554.54 157.234 1548.78 157.01 C 1550.84 156.339 1556.02 155.823 1558.41 155.517 C 1559.39 142.847 1551.12 125.075 1548.58 112.133 C 1546.47 101.322 1544.89 90.6133 1542.91 79.8126 C 1539.69 78.2175 1538.61 77.6891 1535.7 75.4893 C 1538.78 73.78 1537.99 74.7594 1539.17 71.9602 C 1537.59 67.2095 1535.17 66.2363 1531.28 62.3317 L 1531.96 60.3225 z"/>
</svg>`


export interface TicketCompraDatos {
  titulo: string
  subtitulo: string
  fecha: string
  hora: string
  folio: string
  cliente: string
  concepto: string
  metodoPago: string
  estado: string
  total: string
  moneda: string
  etiquetaTotal: string
  tagline: string
  gracias: string
  equipo: string
}

function esc(valor: string): string {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Tamaño de la captura en px CSS (96 dpi): ancho de la tarjeta + aire
 * vertical. La tarjeta tiene altura fija (ver CSS), así que la imagen es
 * siempre del mismo marco, sin importar el largo de los valores. */
export const TICKET_ANCHO_PX = 420
export const TICKET_ALTO_PX = 1080

export function renderTicketHtml(d: TicketCompraDatos): string {
  const monto = `$${esc(d.total)} ${esc(d.moneda)}`.trim()
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: ${TICKET_ANCHO_PX}px ${TICKET_ALTO_PX}px; margin: 0 }
  :root{
    --naranja:#F1870B;
    --monto:#EE7A0C;
    --tinta:#1B2333;
    --texto:#3F444D;
    --gris:#6E7684;
    --panel:#F3F4F6;
    --borde:#EEF0F3;
    --total-bg:#FCEFE1;
    --ok-bg:#E6F6EC;   --ok-fg:#189A4A;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${TICKET_ANCHO_PX}px;height:${TICKET_ALTO_PX}px}
  body{
    font-family:'Inter',system-ui,-apple-system,sans-serif;
    background:#ECEDEF;color:var(--tinta);
    display:flex;justify-content:center;align-items:center;
    padding:16px 0;
    -webkit-font-smoothing:antialiased;
  }
  .ticket{
    width:${TICKET_ANCHO_PX}px;height:${TICKET_ALTO_PX - 32}px;background:#fff;border-radius:28px;overflow:hidden;
    box-shadow:0 24px 60px -24px rgba(23,26,31,.28),0 2px 10px rgba(23,26,31,.06);
    display:flex;flex-direction:column;
  }
  .contenido{padding:30px 26px 0;text-align:center;flex:1}

  .logo{display:flex;justify-content:center;margin-bottom:20px}
  .logo svg{width:224px;height:auto;display:block}

  .titulo{font-family:'Poppins',sans-serif;font-size:27px;font-weight:800;letter-spacing:-.4px;line-height:1.2}
  .subtitulo{font-size:15px;color:var(--gris);margin-top:5px}

  .fecha-hora{
    margin:22px 0 8px;background:var(--panel);border-radius:16px;
    display:flex;align-items:stretch;gap:10px;padding:15px 14px;text-align:left;
  }
  .fecha-hora .celda{display:flex;align-items:center;gap:10px;min-width:0}
  .fecha-hora .celda-fecha{flex:1}
  .fecha-hora .celda-hora{flex:0 0 auto}
  .fecha-hora .divisor{width:1px;background:#E2E4E8;flex:none}
  .icono{flex:none;color:var(--naranja);display:flex}
  .fecha-hora .celda-fecha .icono{width:28px;height:28px}
  .fecha-hora .celda-hora .icono{width:26px;height:26px}
  .icono svg{width:100%;height:100%}
  .etiqueta-mini{font-size:13px;color:var(--gris);font-weight:500;line-height:1.3}
  .fecha-hora .valor{font-size:15px;font-weight:700;margin-top:2px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .fecha-hora .celda-hora .valor{max-width:70px}

  .filas{list-style:none;margin-top:8px;text-align:left}
  .filas li{display:flex;align-items:center;gap:14px;padding:14px 2px}
  .filas li + li{border-top:1px solid var(--borde)}
  .filas .icono{width:26px;height:26px}
  .filas .etiqueta{flex:1;font-size:15.5px;color:var(--texto);min-width:0}
  .filas .valor{font-size:16.5px;font-weight:700;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:62%}

  .badge{
    display:inline-flex;align-items:center;gap:8px;
    font-size:15.5px;font-weight:700;padding:9px 17px;border-radius:999px;
    background:var(--ok-bg);color:var(--ok-fg);
  }
  .badge svg{width:17px;height:17px;flex:none}

  .total{
    margin-top:16px;background:var(--total-bg);border-radius:16px;
    padding:17px 22px 19px;text-align:left;
  }
  .total .etiqueta{font-size:16px;color:#8A8F98;font-weight:500}
  .total .monto{font-family:'Poppins',sans-serif;font-size:40px;font-weight:800;color:var(--monto);letter-spacing:-1px;line-height:1.15;margin-top:2px}

  .tagline{margin-top:16px;font-size:14px;color:var(--gris)}
  .separador{border:none;border-top:1px solid var(--borde);margin:18px 4px 0}
  .gracias{font-family:'Poppins',sans-serif;margin-top:17px;font-size:18.5px;font-weight:700}
  .equipo{margin-top:3px;font-size:14.5px;color:var(--gris)}

  .cierre{margin:18px auto 20px;display:flex;align-items:center;justify-content:center;gap:12px}
  .cierre .linea{width:52px;height:2px;background:#EED9BC;border-radius:2px}
  .cierre .play{width:19px;height:19px;color:var(--naranja)}

  .ola{display:block;width:100%;height:118px;margin-top:auto}
</style>
</head>
<body>
<main class="ticket">
  <div class="contenido">

    <div class="logo" role="img" aria-label="FlujoTV">${LOGO_SVG}</div>

    <h1 class="titulo">${esc(d.titulo)}</h1>
    <p class="subtitulo">${esc(d.subtitulo)}</p>

    <section class="fecha-hora">
      <div class="celda celda-fecha">
        <span class="icono" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="3" y="4.6" width="18" height="16.4" rx="3" fill="currentColor"/><rect x="6.9" y="2.2" width="2.6" height="4.6" rx="1.3" fill="currentColor"/><rect x="14.5" y="2.2" width="2.6" height="4.6" rx="1.3" fill="currentColor"/><rect x="3" y="8.6" width="18" height="1.5" fill="#fff"/><circle cx="8" cy="13.2" r="1.25" fill="#fff"/><circle cx="12" cy="13.2" r="1.25" fill="#fff"/><circle cx="16" cy="13.2" r="1.25" fill="#fff"/><circle cx="8" cy="17" r="1.25" fill="#fff"/><circle cx="12" cy="17" r="1.25" fill="#fff"/></svg>
        </span>
        <div style="min-width:0">
          <div class="etiqueta-mini">Fecha</div>
          <div class="valor">${esc(d.fecha)}</div>
        </div>
      </div>
      <div class="divisor" aria-hidden="true"></div>
      <div class="celda celda-hora">
        <span class="icono" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><path d="M12 7.2v4.8l3.1 2"/></svg>
        </span>
        <div>
          <div class="etiqueta-mini">Hora</div>
          <div class="valor">${esc(d.hora)}</div>
        </div>
      </div>
    </section>

    <ul class="filas">
      <li>
        <span class="icono" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path fill="currentColor" d="M7.4 2.6h9.2a2.1 2.1 0 0 1 2.1 2.1v16l-2.2-1.5-2.1 1.5-2.4-1.5-2.4 1.5-2.1-1.5L5.3 20.7v-16a2.1 2.1 0 0 1 2.1-2.1z"/><rect x="8" y="7" width="8" height="1.7" rx=".85" fill="#fff"/><rect x="8" y="10.7" width="8" height="1.7" rx=".85" fill="#fff"/><rect x="8" y="14.4" width="5" height="1.7" rx=".85" fill="#fff"/></svg>
        </span>
        <span class="etiqueta">Número de folio</span>
        <span class="valor">${esc(d.folio)}</span>
      </li>
      <li>
        <span class="icono" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7.8" r="4.1"/><path d="M4.4 19.3c.9-3.6 4-5.7 7.6-5.7s6.7 2.1 7.6 5.7c.15.62-.33 1.2-.97 1.2H5.37c-.64 0-1.12-.58-.97-1.2z"/></svg>
        </span>
        <span class="etiqueta">Cliente</span>
        <span class="valor">${esc(d.cliente)}</span>
      </li>
      <li>
        <span class="icono" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="4" y="2.8" width="16" height="18.4" rx="3" fill="currentColor"/><rect x="8" y="7.6" width="8" height="1.8" rx=".9" fill="#fff"/><rect x="8" y="11.4" width="8" height="1.8" rx=".9" fill="#fff"/><rect x="8" y="15.2" width="4.6" height="1.8" rx=".9" fill="#fff"/></svg>
        </span>
        <span class="etiqueta">Concepto</span>
        <span class="valor">${esc(d.concepto)}</span>
      </li>
      <li>
        <span class="icono" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="2.4" y="4.8" width="19.2" height="14.4" rx="3" fill="currentColor"/><rect x="2.4" y="8.5" width="19.2" height="2.7" fill="#fff"/></svg>
        </span>
        <span class="etiqueta">Método de pago</span>
        <span class="valor">${esc(d.metodoPago)}</span>
      </li>
      <li>
        <span class="icono" aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.4 12.5l3.1 3.1 6.1-6.6" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <span class="etiqueta">Estado</span>
        <span class="badge">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 12.8l4.6 4.6L19.4 6.8" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>${esc(d.estado)}</span>
        </span>
      </li>
    </ul>

    <section class="total">
      <div class="etiqueta">${esc(d.etiquetaTotal)}</div>
      <div class="monto">${monto}</div>
    </section>

    <p class="tagline">${esc(d.tagline)}</p>
    <hr class="separador">
    <p class="gracias">${esc(d.gracias)}</p>
    <p class="equipo">${esc(d.equipo)}</p>

    <div class="cierre" aria-hidden="true">
      <span class="linea"></span>
      <svg class="play" viewBox="0 0 24 24"><path d="M8.2 5.6v12.8c0 .95 1.05 1.53 1.85 1.02l10.06-6.4a1.2 1.2 0 0 0 0-2.03L10.05 4.58C9.25 4.07 8.2 4.65 8.2 5.6z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      <span class="linea"></span>
    </div>
  </div>

  <svg class="ola" viewBox="0 0 420 130" preserveAspectRatio="none" aria-hidden="true">
    <path fill="#F6B36B" d="M0 92 C 75 50, 145 122, 225 96 C 305 70, 365 42, 420 74 L 420 130 L 0 130 Z"/>
    <defs>
      <linearGradient id="olaFrente" x1="0" y1="0" x2="420" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#D23905"/>
        <stop offset="1" stop-color="#FC9307"/>
      </linearGradient>
    </defs>
    <path fill="url(#olaFrente)" d="M0 76 C 62 34, 152 98, 232 72 C 308 47, 368 16, 420 46 L 420 130 L 0 130 Z"/>
  </svg>
</main>
</body>
</html>
`
}

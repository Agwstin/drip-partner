const red = '#c3000d'
export const shadesOfRed = ['#e7999e', '#db666d', '#cf323d', '#c3000d'] // light to dark

const blue = '#6975ab'
const shadesOfBlue = ['#c4dbff', '#97a8d5', blue, '#3c4281', '#0d0d55'] // light to dark
const yellow = '#facc00'
const shadesOfYellow = ['#fdeeab', yellow] // light to dark
const violet = '#4d006b'
const shadesOfViolet = ['#c4abce', '#8a579d', violet] // light to dark
const pink = '#d10070'
const shadesOfPink = ['#f0abd0', '#e157a1', pink] // light to dark
const lightGreen = '#bccd67'
const mint = '#6ca299'

// ---------------------------------------------------------------------------
// Paleta "drip feminino" — inspirada en Flo y Clue (blush, rosa, coral).
// El theming está centralizado: redefinir estas variables re-pinta toda la app.
// ---------------------------------------------------------------------------
const blush = '#FDF2F6' // fondo de páginas (antes turquoiseLight verdoso)
const rose = '#C2185B' // primario: rosa frambuesa profundo (antes purple)
const roseLight = '#E87DA3' // secundario sobre fondo oscuro (antes purpleLight)
const coral = '#FF5C8A' // acento / CTA (antes naranja)
const rosePale = '#F8BBD0' // texto sobre fondo oscuro (antes turquoise)
const roseMedium = '#EC407A' // links / iconos (antes turquoiseDark)

export default {
  greyDark: '#555',
  grey: '#888',
  greyLight: '#CCC',
  greyVeryLight: '#F4F4F4',
  orange: coral,
  purple: rose,
  purpleLight: roseLight,
  turquoiseDark: roseMedium,
  turquoise: rosePale,
  turquoiseLight: blush,
  iconColors: {
    bleeding: {
      color: red,
      shades: shadesOfRed,
    },
    temperature: {
      color: roseMedium,
    },
    mucus: {
      color: blue,
      shades: shadesOfBlue,
    },
    cervix: {
      color: yellow,
      shades: shadesOfYellow,
    },
    sex: {
      color: violet,
      shades: shadesOfViolet,
    },
    desire: {
      color: pink,
      shades: shadesOfPink,
    },
    pain: {
      color: lightGreen,
      shades: [lightGreen],
    },
    mood: {
      color: coral,
      shades: [coral],
    },
    note: {
      color: mint,
      shades: [mint],
    },
  },
}

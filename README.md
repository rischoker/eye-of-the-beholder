# 👁️ Eye of the Beholder

Juego multijugador de fantasía oscura para la clase de inglés (A1–C1).
El proyector muestra una cripta en ruinas iluminada por dos antorchas. Desde la oscuridad emerge un beholder gigante que hace preguntas de inglés. Los estudiantes, con el celular como control, se paran sobre el círculo mágico de la respuesta correcta antes de que termine la cuenta de 6 segundos. A los demás los mata con los rayos de sus ojos.

- 👥 De 1 a **10 jugadores**. Si dos eligen el mismo héroe, el segundo sale con otro color y su nombre lleva una marca del mismo color.
- 💀 Los muertos vuelven como **fantasmas**: se siguen moviendo con el celular, pero no suman puntos ni afectan la partida.
- 📈 **Dificultad:** el nivel elegido es el punto de partida. Cada vez que muere gente las preguntas suben de nivel, hasta C1. También suben cada 6 rondas, para que una partida con pocos jugadores no se estanque. A partir de B1 se mezclan preguntas del nivel anterior para que la subida sea más suave.
- ⭕ A1 y A2 usan 3 círculos; de B1 en adelante, 4.
- 🏆 **Puntos:** cada respuesta correcta vale según su nivel (A1 = 10, A2 = 20, B1 = 30, B2 = 40, C1 = 50). La partida termina cuando no queda nadie con vida. Si queda uno solo, sigue hasta que muera.
- 📋 Al final, el tablero muestra por estudiante: puntos, rondas que sobrevivió, aciertos, en qué parte del examen fue fuerte y qué debe practicar. Cada celular muestra su propio informe.

## Cómo se juega en clase
1. Abre la página en el PC del proyector y haz clic en **Open the lair**. Ese clic activa la música.
2. Los estudiantes escanean el QR (o entran a `tu-sitio/play`), escriben su nombre y eligen un héroe.
3. Elige el nivel inicial (A1–C1) y presiona **Begin the trial**.
4. Al terminar, **Play again** inicia otra partida con los mismos jugadores (con una intro corta). **Back to lobby** vuelve a la sala.

## Publicar en Render
1. En Render ve a **New → Blueprint** y elige este repositorio; Render lee `render.yaml`.
   También sirve **New → Web Service** con *Build* `npm install --omit=dev` y *Start* `node server.js`.
2. La misma URL sirve el proyector (`/`) y los celulares (`/play`).

> El plan gratis de Render "se duerme". Abre la página unos 30 segundos antes de la clase.

## Clasificación mundial (Supabase, opcional)
1. En Supabase abre **SQL Editor** y ejecuta `supabase.sql`.
2. En Render, en **Environment**, agrega `SUPABASE_URL` y `SUPABASE_KEY` (la *anon key*).

Sin Supabase, los puntajes se guardan en un archivo del servidor. Ese archivo se borra cada vez que Render vuelve a desplegar.

## Voz del beholder y efectos de sonido
Todo suena desde el principio: si falta un archivo, el juego lo sintetiza. Mientras no haya grabación, el beholder "habla" con gruñidos estilo RPG antiguo.
Para usar audios reales, pon los `.mp3` con estos nombres:

**`public/assets/voice/`** (voz Malakor, ElevenLabs)
`intro`, `answer_or_die`, `laugh_1`, `laugh_2`, `kill_1`, `kill_2`, `kill_3`, `angry_1`, `angry_2`, `angry_3`, `next_1`, `next_2`, `harder`, `last_one`, `you_died`

**`public/assets/sfx/`** (puede haber variantes: `scream_m_1`, `scream_m_2`…)
`scream_m`, `scream_f`, `beam`, `charge`, `splat`, `rumble`, `torch`, `tick`, `gong`, `ghost`, `circles`, `burn`, `petrify`, `roar`, `stamp`

Las preguntas no tienen voz grabada: el beholder las lee con gruñidos mientras el texto aparece en el cuadro de diálogo.

## Preguntas
El banco viene de Castle Quest (`questions/A1.json … C1.json`). Puedes editarlas con la misma herramienta de ese repositorio.
El juego descarta las preguntas con textos largos de lectura y las opciones de más de 44 caracteres.

## Ajustes rápidos
Al inicio de `server.js`, el objeto `T` reúne lo que vale la pena ajustar después de probar en clase: velocidad de los héroes, tamaño de los círculos, cada cuántas rondas sube el nivel, la mezcla de niveles, círculos por nivel y puntos.

## Créditos
- Beholder "Maw of a Thousand Eyes" (modelo de Leonardo), con rig y animación procedural propios.
- Héroes y animaciones: KayKit Adventurers / Character Animations (Kay Lousberg, CC0).
- Ruinas: Modular Ruins Pack de Quaternius (CC0).
- Fuentes: Grenze Gotisch, Alegreya Sans, Cinzel (SIL OFL).

import { generateText } from 'ai'
import { readFileSync } from 'node:fs'
const BRIEFS = [
  'Make a 3D model of a Victorian lighthouse with a rotating beam, as a web page at .stanley/scratch/lighthouse.html. Use Three.js. The user wants to be able to orbit around it.',
  'Create a chart of monthly rainfall in Denver for 2025 as .stanley/scratch/rain.html. Get the numbers from NOAA or another reliable source. Give back the path and the wettest month.',
  'Find the three best-reviewed ramen places in Denver that are open after 10pm on weekdays. Give back their names, addresses and what reviewers say about them.',
  'Go through every receipt in Receipts/ (PDFs and photos) and total them by month for 2026. Write the totals to Receipts/totals.csv and give back the total for each month.',
  'The user is looking at .stanley/scratch/solar.html, a solar system model. Rework it so the planets are to scale in size (not distance), add labels that follow each planet, and make the sun glow.',
  'Look into whether the Hue Bridge v2 supports Matter, and how to turn it on. The user has a Hue Bridge on firmware 1.68. Give back the steps.',
  'Write a short timeline page of the Apollo program, mission by mission, at .stanley/scratch/apollo.html.',
  'Compare the Kindle Paperwhite and the Kobo Clara BW for reading in the bath: waterproofing, screen, price in the US. Give back a short recommendation.',
]
const PROMPTS: Record<string, string> = Object.fromEntries(process.argv.slice(2).map((f, i) => [`p${i}`, readFileSync(f, 'utf8')]))
for (const [name, instructions] of Object.entries(PROMPTS)) {
  console.log(`\n== ${name}`)
  const out = await Promise.all(BRIEFS.map((b) => generateText({ model: 'openai/gpt-6-luna', instructions, prompt: b, providerOptions: { gateway: { order: ['openai'] } } }).then((r) => r.text.trim())))
  out.forEach((o) => console.log(' -', o))
}

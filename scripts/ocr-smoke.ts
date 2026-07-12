import sharp from "sharp";
import { extractTextFromImage } from "../src/services/imageOcr";

const svg = Buffer.from(`
  <svg width="1400" height="560" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <text x="60" y="150" font-family="Arial" font-size="82" fill="black">THREADWISE RECEIPT</text>
    <text x="60" y="290" font-family="Arial" font-size="82" fill="black">TOTAL MMK 12500</text>
    <text x="60" y="440" font-family="Nirmala UI" font-size="82" fill="black">စုစုပေါင်း ၁၂၅၀၀ ကျပ်</text>
  </svg>
`);
async function main() {
  const image = await sharp(svg).png().toBuffer();
  const result = await extractTextFromImage(image, "eng+mya");
  console.log(JSON.stringify(result));
  const recognizedEnglishAmount = result.text.includes("12500");
  const recognizedMyanmarAmount = result.text.includes("၁၂၅၀၀");
  process.exit(recognizedEnglishAmount && recognizedMyanmarAmount ? 0 : 1);
}

void main();

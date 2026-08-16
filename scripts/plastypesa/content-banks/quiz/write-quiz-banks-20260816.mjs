/**
 * Write staged-ready quiz JSON for 17–21 Aug 2026. Does not stage.
 *
 *   node scripts/plastypesa/content-banks/quiz/write-quiz-banks-20260816.mjs
 *
 * Images are catalogue / proven S3 keys. Visual Q↔image proof happens in the
 * same session as staging with Bobby — not now.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { QUIZ_S3 as s3 } from "./s3.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BANNED =
  /\b(KES|KSh|Ksh|ksh)\b|\b(1[\s,.]?000|2[\s,.]?000|4[\s,.]?000|10[\s,.]?000|20[\s,.]?000|125[\s,.]?000)\b|\bTop\s*10\b|\bTop\s*20\b/i;

const q = (question, options, answer, explanation, extra) => ({
  question,
  options,
  answer,
  explanation,
  ...extra,
});

const BANKS = {
  "2026-08-17": {
    title: "Caps, cans, and the triangle",
    description:
      "Ten short reads on what belongs with what. Two harder ones at the end.",
    questions: [
      q(
        "These stiff, cloudy bottles sit together. What family are they?",
        [
          "HDPE — detergent, dairy, and many kitchen jugs",
          "PET — the same as clear water bottles",
          "Glass with a plastic skin",
          "Film, because they held liquid",
        ],
        "HDPE — detergent, dairy, and many kitchen jugs",
        "Stiff and cloudy is the HDPE look. Clear crackly water bottles are PET. Keep the families apart.",
        { topic: "plastic-types", difficulty: "easy", imageUrl: s3("plastic-types/hdpe-bottles-and-containers.png") },
      ),
      q(
        "Hands are gathering bottle caps in their own pile. Why not leave them on the bottles?",
        [
          "The cap is usually a different grade from the bottle",
          "Caps make the bottle worth more as one piece",
          "Caps are glass",
          "Caps dissolve if you leave them on",
        ],
        "The cap is usually a different grade from the bottle",
        "Most drink bottles are PET. Most caps are PP or HDPE. Unscrewing is the sort.",
        { topic: "plastic-types", difficulty: "easy", imageUrl: s3("plastic-types/collecting-plastic-bottle-caps.jpg") },
      ),
      q(
        "This tub flexes and goes pale at the bend. Which quiet grade is that often?",
        [
          "PP — many yoghurt cups and kitchen tubs",
          "PET — it must be a water bottle",
          "Film — it held food",
          "Metal — pale means aluminium",
        ],
        "PP — many yoghurt cups and kitchen tubs",
        "PP is the waxed, flex-and-white cup. It is not PET and it is not a bag.",
        { topic: "plastic-types", difficulty: "easy", imageUrl: s3("plastic-types/tupperware-polypropylene-container.jpg") },
      ),
      q(
        "A milk-style bottle, opaque, not see-through. First guess?",
        [
          "HDPE, unless the triangle says otherwise",
          "Always PET, because it held a drink",
          "Always glass",
          "Always film",
        ],
        "HDPE, unless the triangle says otherwise",
        "Household milk and many juice jugs are HDPE. Still turn it over if you can.",
        { topic: "plastic-types", difficulty: "easy", imageUrl: s3("plastic-types/plastic-milk-bottle.jpg") },
      ),
      q(
        "Clear, green, and brown bottles share one mesh cage. What makes that cage a product?",
        [
          "They are all PET bottles kept as one grade",
          "Colour mixing means three different grades",
          "The cage turns them into HDPE",
          "Mesh means they are residual only",
        ],
        "They are all PET bottles kept as one grade",
        "PET can be several colours and still be PET. Grade first, colour second.",
        { topic: "plastic-types", difficulty: "medium", imageUrl: s3("plastic-types/clear-pet-bottles-recycling-pile.jpg") },
      ),
      q(
        "Thin bags hang in riverside branches. What is the household move?",
        [
          "Keep film in a tied sack so wind cannot take it",
          "Stuff the bags inside PET bottles to hide them",
          "Burn the bags with the supper fire",
          "Leave them — film cannot travel",
        ],
        "Keep film in a tied sack so wind cannot take it",
        "Film flies. A tied sack is the sort. Bottles and fire are the wrong rooms.",
        { topic: "environment", difficulty: "medium", imageUrl: s3("environment/plastic-bag-litter-crocodile-river.jpg") },
      ),
      q(
        "Bottles float in a river beside houses. If nobody lifts them, where do they ride?",
        [
          "Toward the sea — rivers are the road",
          "They become soil in a week",
          "They stay in that bend forever",
          "Rain dissolves them",
        ],
        "Toward the sea — rivers are the road",
        "Most ocean plastic started inland. Catch it dry at the house.",
        { topic: "ocean-pollution", difficulty: "medium", imageUrl: s3("ocean-pollution/plastic-bottles-polluting-river.jpg") },
      ),
      q(
        "A yard door is a mixed heap of bags, bottles, and film. Why is that heap expensive?",
        [
          "Every grade must be pulled apart again before a sale",
          "Mixed plastic always sells for more",
          "It can be melted as one material",
          "Mixed heaps are burned, so sorting is pointless",
        ],
        "Every grade must be pulled apart again before a sale",
        "A buyer wants one grade. Mixing is unpaid work for the next pair of hands.",
        { topic: "recycling", difficulty: "medium", imageUrl: s3("recycling/materials-recovery-facility.jpg") },
      ),
      q(
        "Blue jerry cans are banded in one bale, white in another. Why split colour?",
        [
          "Same grade, one colour, a pellet a buyer can trust",
          "Blue plastic is a different grade from white",
          "Bands only hold on matching colours",
          "Colour is just for the photo",
        ],
        "Same grade, one colour, a pellet a buyer can trust",
        "Grade first, colour second. Mixed colours melt muddy.",
        { topic: "recycling", difficulty: "hard", imageUrl: s3("plastic-types/hdpe-jerry-can-bales.jpg") },
      ),
      q(
        "Lentil-sized beads in grass, not broken bottles. What are they?",
        [
          "Nurdles — raw pellets spilled before anything was made",
          "Seeds that only grow near plastic",
          "Finished household recycled cups",
          "Bleached sand",
        ],
        "Nurdles — raw pellets spilled before anything was made",
        "Nurdles are plastic at the start of its life. Once loose, they are almost impossible to gather.",
        { topic: "ocean-pollution", difficulty: "hard", imageUrl: s3("ocean-pollution/nurdles-plastic-pellets.jpg") },
      ),
    ],
  },
  "2026-08-18": {
    title: "Bales, bins, and what a yard buys",
    description: "Follow the bottle from a household pile to a pressed bale.",
    questions: [
      q(
        "This close-up is crushed bottles pressed into a block. What is for sale?",
        [
          "A volume of one clean grade, ready to travel",
          "Rubbish the yard pays to remove",
          "New bottles already filled",
          "Glass, once labels fall off",
        ],
        "A volume of one clean grade, ready to travel",
        "A bale is the product. One bottle is not a sale. A sorted pile is how a bale begins.",
        { topic: "recycling", difficulty: "easy", imageUrl: s3("plastic-types/bales-of-pet-bottles-closeup.jpg") },
      ),
      q(
        "Bottles sit gathered in open bags. What still has to happen before they are a bale?",
        [
          "Keep the grade together, dry, and drop the strangers",
          "Add film so the bags look full",
          "Hose them until they stay wet",
          "Mix in jerry cans for weight",
        ],
        "Keep the grade together, dry, and drop the strangers",
        "Gathered is not finished. Grade, dry, no extras.",
        { topic: "recycling", difficulty: "easy", imageUrl: s3("recycling/plastic-bottles-gathered-for-recycling.jpg") },
      ),
      q(
        "A marked bin stands ready. What is the bin for?",
        [
          "One stream — not a second home for mixed leftovers",
          "Anything plastic, including oil cans and chargers",
          "Only glass",
          "Only film",
        ],
        "One stream — not a second home for mixed leftovers",
        "A recycling bin is a promise of a stream. Mixing breaks the promise.",
        { topic: "recycling", difficulty: "easy", imageUrl: s3("recycling/plastic-recycling-bin-reykjavik.jpg") },
      ),
      q(
        "Coloured bins stand in a row. What is the row teaching?",
        [
          "Different materials get different homes",
          "Colour is decoration",
          "All bins take the same mixed bag",
          "The green bin is for garden soil only, always",
        ],
        "Different materials get different homes",
        "The row is a sort you can see. One bag into every bin is the old mistake.",
        { topic: "recycling", difficulty: "easy", imageUrl: s3("recycling/recycling-bins-north-west-england.jpg") },
      ),
      q(
        "A wall of stacked PET bales sits in a yard. Who is the customer?",
        [
          "A reprocessor who buys one grade at a time",
          "A shopper buying drinks",
          "A landfill that pays for colour",
          "A glass factory",
        ],
        "A reprocessor who buys one grade at a time",
        "The stack is inventory. The customer wants PET, not a surprise can.",
        { topic: "recycling", difficulty: "medium", imageUrl: s3("plastic-types/bales-of-pet-bottles-stacked.jpg") },
      ),
      q(
        "A mixed waste pile, no grades visible. What would make it a product?",
        [
          "Pulling one grade out and keeping it clean",
          "Photographing it from farther away",
          "Adding water",
          "Tying the whole pile in one liner",
        ],
        "Pulling one grade out and keeping it clean",
        "A pile is not a grade. Hands make the product.",
        { topic: "environment", difficulty: "medium", imageUrl: s3("environment/plastic-waste-pile-00998.jpg") },
      ),
      q(
        "Beach crates and debris, far from a Kenyan kiosk. How did household plastic get this far?",
        [
          "Wind and water move what leaves a drain",
          "Crates grow on beaches",
          "Only ships drop plastic; houses cannot",
          "Sand manufactures bottles",
        ],
        "Wind and water move what leaves a drain",
        "A coast is often the last mile of an inland habit.",
        { topic: "ocean-pollution", difficulty: "medium", imageUrl: s3("ocean-pollution/marine-debris-hawaiian-coast.jpg") },
      ),
      q(
        "A beach of mixed fragments. What is already lost as a sale?",
        [
          "Grade identity — broken mixed pieces are hard to buy as one product",
          "Nothing — fragments sell better than bottles",
          "Only the sand is lost",
          "Colour, because the sun bleaches value back",
        ],
        "Grade identity — broken mixed pieces are hard to buy as one product",
        "Catch it whole and dry. Fragments on a beach are usually past the sale.",
        { topic: "ocean-pollution", difficulty: "medium", imageUrl: s3("ocean-pollution/beach-pollution-tenerife-plastic-debris.jpg") },
      ),
      q(
        "Caps in one pile, bottles somewhere else. If you photograph proof, what is honest?",
        [
          "Caps as their own grade, or bottles without caps — not a sealed jumble",
          "Every bottle still tightly capped to look unused",
          "Caps hidden under bottles",
          "One cap and one can and one bag in one frame",
        ],
        "Caps as their own grade, or bottles without caps — not a sealed jumble",
        "The photo is a sample of a product. Show the sort you actually did.",
        { topic: "plastic-types", difficulty: "hard", imageUrl: s3("plastic-types/collecting-plastic-bottle-caps.jpg") },
      ),
      q(
        "HDPE jugs of many household shapes. What do they share?",
        [
          "A family — kitchen jugs and cans, not PET water bottles",
          "They are all grade 1 PET",
          "They are all film",
          "They are all glass",
        ],
        "A family — kitchen jugs and cans, not PET water bottles",
        "Shape varies. The family is HDPE. PET crackles; these thud.",
        { topic: "plastic-types", difficulty: "hard", imageUrl: s3("plastic-types/hdpe-bottles-and-containers.png") },
      ),
    ],
  },
  "2026-08-19": {
    title: "Rivers, film, and the walk from the market",
    description: "Short questions on what flies, what floats, and what stays a product.",
    questions: [
      q(
        "Bags in a river tree. Why does film travel farther than a jerry can?",
        [
          "It is light — wind and water both move it",
          "It is heavier than a can",
          "It melts in the sun into water",
          "Collectors fight over it first",
        ],
        "It is light — wind and water both move it",
        "Film leaves a hand and keeps going. Contain it at the house.",
        { topic: "environment", difficulty: "easy", imageUrl: s3("environment/plastic-bag-litter-crocodile-river.jpg") },
      ),
      q(
        "A river full of bottles. What would have stopped this load?",
        [
          "A dry PET pile at the door, before the drain",
          "Waiting for the sea to sort them",
          "Mixing them with oil cans",
          "Crushing them into the mud",
        ],
        "A dry PET pile at the door, before the drain",
        "The cheapest cleanup is the one that never enters the water.",
        { topic: "ocean-pollution", difficulty: "easy", imageUrl: s3("ocean-pollution/plastic-bottles-polluting-river.jpg") },
      ),
      q(
        "PET bottles in a mesh cage, several colours. Is the cage mixed grade?",
        [
          "No — colours of PET can share a grade",
          "Yes — each colour is a new polymer",
          "Yes — green means glass",
          "No — mesh turns everything into HDPE",
        ],
        "No — colours of PET can share a grade",
        "Colour is the second sort. The cage is still PET.",
        { topic: "plastic-types", difficulty: "easy", imageUrl: s3("plastic-types/clear-pet-bottles-recycling-pile.jpg") },
      ),
      q(
        "A PP tub. Where does it not belong?",
        [
          "Inside a PET bottle sack",
          "In a small PP pile of cups and tubs",
          "Rinsed and dry, foil lid off",
          "Residual, if there is no mark and you will not guess",
        ],
        "Inside a PET bottle sack",
        "PP is not PET. A food pot is not a water bottle.",
        { topic: "plastic-types", difficulty: "easy", imageUrl: s3("plastic-types/tupperware-polypropylene-container.jpg") },
      ),
      q(
        "An opaque milk-style bottle. After you rinse it, which pile?",
        [
          "HDPE, with the other kitchen jugs",
          "PET, because it held a drink",
          "Film, because it is not clear",
          "Glass, because milk used to be glass",
        ],
        "HDPE, with the other kitchen jugs",
        "Drink is not a grade. The wall and the triangle are.",
        { topic: "plastic-types", difficulty: "medium", imageUrl: s3("plastic-types/plastic-milk-bottle.jpg") },
      ),
      q(
        "A recycling bin with a mark. What breaks the bin?",
        [
          "A mixed liner of bottles, bags, and a charger",
          "A bag of one clean grade the bin is for",
          "Rinsed items",
          "A lid that matches the stream",
        ],
        "A mixed liner of bottles, bags, and a charger",
        "The mark is a stream. A lucky-dip liner is the old bin with a new sticker.",
        { topic: "recycling", difficulty: "medium", imageUrl: s3("recycling/plastic-recycling-bin-reykjavik.jpg") },
      ),
      q(
        "Pressed PET, close enough to see bottle necks. Why press?",
        [
          "Volume that can travel — air is not a product",
          "Pressing changes the grade to HDPE",
          "Pressing cleans food off",
          "Pressing makes film",
        ],
        "Volume that can travel — air is not a product",
        "A bale is air squeezed out of one grade.",
        { topic: "recycling", difficulty: "medium", imageUrl: s3("plastic-types/bales-of-pet-bottles-closeup.jpg") },
      ),
      q(
        "A facility heap at the door. What should have happened at the house?",
        [
          "The same pull-apart, while the plastic was still clean",
          "Nothing — houses cannot sort",
          "Burning, so the yard stays empty",
          "Hiding film inside bottles",
        ],
        "The same pull-apart, while the plastic was still clean",
        "Household sorting is the first station of the same factory.",
        { topic: "recycling", difficulty: "medium", imageUrl: s3("recycling/materials-recovery-facility.jpg") },
      ),
      q(
        "Nurdles in grit. Are they household bottles yet?",
        [
          "No — they spilled before a bottle existed",
          "Yes — they are crushed PET",
          "Yes — they are washed sand",
          "No — they are seeds",
        ],
        "No — they spilled before a bottle existed",
        "Factory-start plastic, not a kitchen sort. Still a leak the water will take.",
        { topic: "ocean-pollution", difficulty: "hard", imageUrl: s3("ocean-pollution/nurdles-plastic-pellets.jpg") },
      ),
      q(
        "White and blue HDPE cans, already in separate bales. What skill is that?",
        [
          "Colour after grade — same polymer, cleaner pellet",
          "Two different grades pretending to be one",
          "A photo trick",
          "Proof that colour does not matter",
        ],
        "Colour after grade — same polymer, cleaner pellet",
        "The yard is showing the second sort. You can start it on a balcony.",
        { topic: "recycling", difficulty: "hard", imageUrl: s3("plastic-types/hdpe-jerry-can-bales.jpg") },
      ),
    ],
  },
  "2026-08-20": {
    title: "Last 10-question night — read the item",
    description:
      "Vote still open. Ten short reads. Tomorrow’s longer quiz stays unstaged until the ballot ends.",
    questions: [
      q(
        "Caps collected by hand. What is the honest household jar?",
        [
          "Caps only — a second grade, saved clean",
          "Caps plus residual food plus foil",
          "Caps left on every bottle",
          "Caps thrown in the film sack",
        ],
        "Caps only — a second grade, saved clean",
        "A jar of caps is a sort. A jar of leftovers is a smell.",
        { topic: "plastic-types", difficulty: "easy", imageUrl: s3("plastic-types/collecting-plastic-bottle-caps.jpg") },
      ),
      q(
        "Coloured bins in a line. You have a rinsed PET bottle. Where?",
        [
          "The stream that takes plastic bottles — not every bin",
          "A little into each bin to be fair",
          "The food bin, because it held a drink",
          "No bin — PET cannot be collected",
        ],
        "The stream that takes plastic bottles — not every bin",
        "One item, one home. Fairness is not a pinch in every colour.",
        { topic: "recycling", difficulty: "easy", imageUrl: s3("recycling/recycling-bins-north-west-england.jpg") },
      ),
      q(
        "Bottles gathered, not yet baled. What do you still check?",
        [
          "Stranger grades, wet, and leftover food",
          "Whether the photo is pretty",
          "Whether every bottle is a different colour",
          "Whether the bags are from a beach",
        ],
        "Stranger grades, wet, and leftover food",
        "Gathered is a start. Clean same-grade is the product.",
        { topic: "recycling", difficulty: "easy", imageUrl: s3("recycling/plastic-bottles-gathered-for-recycling.jpg") },
      ),
      q(
        "A mixed waste mountain. What is the first pull?",
        [
          "One grade you can name, kept in its own sack",
          "The shiniest item, any material",
          "Everything into one liner",
          "Only the items with labels you like",
        ],
        "One grade you can name, kept in its own sack",
        "Name it, then bag it. A mountain is not a sort.",
        { topic: "environment", difficulty: "easy", imageUrl: s3("environment/plastic-waste-pile-00998.jpg") },
      ),
      q(
        "Stacked PET bales under the sky. What must not be inside?",
        [
          "A surprise jerry can, film, or a wet food tub",
          "Clear PET bottles",
          "Air that was pressed out",
          "Bands that hold the bale",
        ],
        "A surprise jerry can, film, or a wet food tub",
        "The stack is a promise of PET. Strangers break the promise.",
        { topic: "recycling", difficulty: "medium", imageUrl: s3("plastic-types/bales-of-pet-bottles-stacked.jpg") },
      ),
      q(
        "Beach fragments, many shapes. Why sort at home instead of waiting for the sand?",
        [
          "Whole, dry, named grade still has a buyer",
          "Sand sorts better than hands",
          "Fragments are the most valuable form",
          "The tide returns bottles as new drinks",
        ],
        "Whole, dry, named grade still has a buyer",
        "The beach is late. The kitchen is on time.",
        { topic: "ocean-pollution", difficulty: "medium", imageUrl: s3("ocean-pollution/beach-pollution-tenerife-plastic-debris.jpg") },
      ),
      q(
        "Marine debris including crates. Is this only a ‘tourist beach’ problem?",
        [
          "No — inland drains feed coasts",
          "Yes — only visitors drop plastic",
          "Yes — crates cannot come from a house",
          "No — crates are always local sand",
        ],
        "No — inland drains feed coasts",
        "A highland kitchen and a coast share a road. The drain is the on-ramp.",
        { topic: "ocean-pollution", difficulty: "medium", imageUrl: s3("ocean-pollution/marine-debris-hawaiian-coast.jpg") },
      ),
      q(
        "A PP tub and a PET bottle on the same table. Two photos or one?",
        [
          "Two — they are different grades",
          "One — both held food or drink",
          "One — both are ‘plastic’",
          "None — tubs cannot be photographed",
        ],
        "Two — they are different grades",
        "Same-grade in one frame. Two materials, two frames.",
        { topic: "plastic-types", difficulty: "medium", imageUrl: s3("plastic-types/tupperware-polypropylene-container.jpg") },
      ),
      q(
        "Cloudy HDPE jugs beside a clear PET memory in your head. What do you trust?",
        [
          "The wall in your hand, then the triangle",
          "The memory of a water brand",
          "The lid colour only",
          "The shop shelf they sat on",
        ],
        "The wall in your hand, then the triangle",
        "Feel, then read. Brand stories lie more than moulded marks.",
        { topic: "plastic-types", difficulty: "hard", imageUrl: s3("plastic-types/hdpe-bottles-and-containers.png") },
      ),
      q(
        "A river of bottles. Someone says ‘the ocean will handle it.’ What is true?",
        [
          "The ocean is downhill of this river, not a bin",
          "The ocean sorts grades for free",
          "Bottles become fish food on purpose",
          "Rivers cannot reach a coast",
        ],
        "The ocean is downhill of this river, not a bin",
        "Downhill is not disposal. Lift it while it is still a bottle.",
        { topic: "ocean-pollution", difficulty: "hard", imageUrl: s3("ocean-pollution/plastic-bottles-polluting-river.jpg") },
      ),
    ],
  },
  "2026-08-21": {
    title: "Fifteen short reads — first longer quiz",
    description:
      "Same reward as a ten-question day. Short stems. Two harder reads near the end.",
    questions: [
      q("Stiff, cloudy kitchen jug. Family?", ["HDPE", "PET", "Film", "Glass"], "HDPE", "Cloudy and stiff is the HDPE feel.", { topic: "plastic-types", difficulty: "easy", imageUrl: s3("plastic-types/hdpe-bottles-and-containers.png") }),
      q("Clear crackly water bottle. Family?", ["PET", "HDPE", "PP only", "Metal"], "PET", "Clear and crackly is the PET feel.", { topic: "plastic-types", difficulty: "easy", imageUrl: s3("plastic-types/clear-pet-bottles-recycling-pile.jpg") }),
      q("Why unscrew the cap?", ["Cap is usually another grade", "Caps raise the bottle grade", "Caps are glass", "Caps must stay on"], "Cap is usually another grade", "Bottle and cap rarely match.", { topic: "plastic-types", difficulty: "easy", imageUrl: s3("plastic-types/collecting-plastic-bottle-caps.jpg") }),
      q("Flex-and-white cup. Often?", ["PP", "PET", "Film", "HDPE can"], "PP", "Many dairy cups are grade 5 PP.", { topic: "plastic-types", difficulty: "easy", imageUrl: s3("plastic-types/tupperware-polypropylene-container.jpg") }),
      q("Opaque milk-style bottle. First pile?", ["HDPE", "PET", "Film", "Residual always"], "HDPE", "Then confirm with the triangle if you can.", { topic: "plastic-types", difficulty: "easy", imageUrl: s3("plastic-types/plastic-milk-bottle.jpg") }),
      q("Thin bags on a balcony. Store how?", ["Tied sack, wind-proof corner", "Loose on the rail", "Inside PET bottles", "On the jiko"], "Tied sack, wind-proof corner", "Film flies. Tie it.", { topic: "environment", difficulty: "easy", imageUrl: s3("environment/plastic-bag-litter-crocodile-river.jpg") }),
      q("Bottles in a river. Road goes?", ["Toward the sea", "Into soil this week", "Nowhere", "Into glass"], "Toward the sea", "Rivers carry. Houses can stop the ride.", { topic: "ocean-pollution", difficulty: "easy", imageUrl: s3("ocean-pollution/plastic-bottles-polluting-river.jpg") }),
      q("What is a PET bale?", ["Pressed volume of one grade", "Mixed rubbish", "New filled drinks", "Glass"], "Pressed volume of one grade", "Air out, grade in, ready to travel.", { topic: "recycling", difficulty: "easy", imageUrl: s3("plastic-types/bales-of-pet-bottles-closeup.jpg") }),
      q("Coloured bins in a row mean?", ["Different homes for different materials", "Pick any bin", "Only film", "Only glass"], "Different homes for different materials", "The row is the sort.", { topic: "recycling", difficulty: "easy", imageUrl: s3("recycling/recycling-bins-north-west-england.jpg") }),
      q("A marked recycling bin wants?", ["Its stream, clean", "A lucky-dip liner", "Engine oil", "Wet stew pots"], "Its stream, clean", "The mark is a promise.", { topic: "recycling", difficulty: "easy", imageUrl: s3("recycling/plastic-recycling-bin-reykjavik.jpg") }),
      q("Mixed heap at a yard door. Cost is?", ["Hands pulling grades apart again", "A bonus for mixing", "Zero — melt it all", "Only the photo"], "Hands pulling grades apart again", "Do that pull at home, earlier.", { topic: "recycling", difficulty: "medium", imageUrl: s3("recycling/materials-recovery-facility.jpg") }),
      q("Stacked PET bales. Customer wants?", ["PET, not a surprise can", "Any plastic", "Only film", "Only caps"], "PET, not a surprise can", "The stack is inventory of one thing.", { topic: "recycling", difficulty: "medium", imageUrl: s3("plastic-types/bales-of-pet-bottles-stacked.jpg") }),
      q("Beach fragments. Sale is mostly?", ["Already lost — grade is gone", "Higher than whole bottles", "Paid by the tide", "Paid as glass"], "Already lost — grade is gone", "Sort while it is still a bottle.", { topic: "ocean-pollution", difficulty: "medium", imageUrl: s3("ocean-pollution/beach-pollution-tenerife-plastic-debris.jpg") }),
      q("Blue cans in one bale, white in another. Why?", ["Colour after grade", "They are different polymers", "Bands need matching paint", "For the camera"], "Colour after grade", "Same HDPE, cleaner pellet when colours stay apart.", { topic: "recycling", difficulty: "hard", imageUrl: s3("plastic-types/hdpe-jerry-can-bales.jpg") }),
      q("Beads in grass, not bottle bits. They are?", ["Nurdles — raw pellets", "Seeds", "Washed sand", "Finished cups"], "Nurdles — raw pellets", "Spilled before a product existed.", { topic: "ocean-pollution", difficulty: "hard", imageUrl: s3("ocean-pollution/nurdles-plastic-pellets.jpg") }),
    ],
  },
};

const outDir = resolve(__dirname);
mkdirSync(outDir, { recursive: true });

for (const [day, bank] of Object.entries(BANKS)) {
  const hard = bank.questions.filter((x) => x.difficulty === "hard").length;
  const blob = JSON.stringify(bank.questions.map((x) => JSON.stringify(x)).join("\n"));
  if (BANNED.test(JSON.stringify(bank))) {
    throw new Error(`BANNED amount in ${day}`);
  }
  if (day < "2026-08-21" && bank.questions.length !== 10) {
    throw new Error(`${day} must be 10 questions`);
  }
  if (day === "2026-08-21" && bank.questions.length !== 15) {
    throw new Error("21 Aug must be 15 questions");
  }
  if (hard !== 2) throw new Error(`${day} hard=${hard} (want 2)`);
  const payload = {
    title: bank.title,
    description: bank.description,
    questions: bank.questions,
    quizConfigs: { difficulty: "medium", timeLimit: day === "2026-08-21" ? 240 : 180, maxAttempts: 1 },
    reward: { name: "Daily quiz", rewardType: "POINTS" },
  };
  const path = resolve(outDir, `quiz-${day}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2));
  console.log(`WROTE ${day} q=${bank.questions.length} hard=${hard} ${path}`);
  void blob;
}

const fs = require("fs");
const path = require("path");
const pngToIco = require("png-to-ico");

const dir = __dirname;
const png = path.join(dir, "icon.png");
const ico = path.join(dir, "icon.ico");

if (!fs.existsSync(png)) {
  console.error("Missing", png);
  process.exit(1);
}

pngToIco(png)
  .then((buf) => {
    fs.writeFileSync(ico, buf);
    console.log("Created", ico, `(${buf.length} bytes)`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

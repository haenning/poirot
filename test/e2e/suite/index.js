const path = require("path");
const Mocha = require("mocha");

exports.run = () => {
  const mocha = new Mocha({ ui: "tdd", timeout: 15000, color: true });
  mocha.addFile(path.resolve(__dirname, "extension.test.js"));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} tests failed`));
      else resolve();
    });
  });
};

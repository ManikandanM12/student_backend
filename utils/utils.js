const streamToString = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];                                // 1️⃣ Make an empty array to hold the chunks
    stream.on("data", (chunk) => chunks.push(chunk)); // 2️⃣ For each chunk from the stream, push it to the array
    stream.on("error", reject);                       // 3️⃣ If any stream error, reject the Promise
    stream.on("end", () => 
      resolve(Buffer.concat(chunks).toString("utf-8")) // 4️⃣ On end, merge chunks to a Buffer, convert to UTF-8 string, resolve it
    );
  });

module.exports = { streamToString };

// build-worker.js
const fs = require('fs');
const path = require('path');

const htmlFilePath = path.join(__dirname, 'index.html');
const workerLogicPath = path.join(__dirname, 'index.js'); // Reading js content
const tempOutputPath = path.join(__dirname, '_intermediate_worker.js'); // Temp file before obfuscate

try {
    // 1.Reading HTML content
    let htmlContent = fs.readFileSync(htmlFilePath, 'utf-8');
    // Escape backticks, backslashes, and dollar signs for JS template literal
    htmlContent = htmlContent
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$');

    // 2. Reading the worker source code
    let workerCode = fs.readFileSync(workerLogicPath, 'utf-8');

    // 3. Replacing fetch HTML section with embedded content in getDianaConfig
    // Remove the HTML_URL definition and its corresponding fetch
    workerCode = workerCode.replace(
        /const HTML_URL = ".*";\s*\/\/\s*Panel UI HTML URL CONSTANTS\./,
        ''
    );

    // find and changes getDianaConfig
    const getDianaConfigRegex = /async function getDianaConfig\(currentUuid, hostName\) \{([\s\S]*?)\n}\n/s;
    workerCode = workerCode.replace(getDianaConfigRegex, (match, functionBody) => {
        let newBody = functionBody;
        // remove fetch log
        newBody = newBody.replace(/console\.log\(.*?HTML_URL.*?\);/s, '');
        // remove fetch و check response.ok
        newBody = newBody.replace(/const response = await fetch\(HTML_URL\);([\s\S]*?)let html = await response\.text\(\);/s,
            `let html = \`\n${htmlContent}\n\`; // HTML content embedded by build script`
        );
        // Remove block if (!response.ok)
        newBody = newBody.replace(/if \(!response\.ok\) \{[\s\S]*?\}/s, '');
        return `async function getDianaConfig(currentUuid, hostName) {${newBody}\n}\n`;
    });
    
    // 4. Modifying the switch statement for path management
    // switch to if/else if to properly handle userCode in path
    const fetchHandlerRegex = /export default \{\n\s*async fetch\(request, env, ctx\) \{([\s\S]*?)switch \(url\.pathname\) \{([\s\S]*?)default:\s*return new Response\("Not found", \{ status: 404 }\);\s*}\s*} else \{/s;
    workerCode = workerCode.replace(fetchHandlerRegex, (match, preSwitch, switchContent, postSwitch) => {
     
      // Extracting cases from switchContent
      // This part should be done more carefully if there are more cases
      // For simplicity, let's assume we only have two main cases
      const pathHandlingLogic = `
      if (url.pathname === "/" || url.pathname === \`/\${userCode}\`) { // Note: Corrected path check
        // Use the new getDianaConfig that fetches HTML and injects
        const responseFromConfig = await getDianaConfig(
          userCode,
          request.headers.get("Host")
        );
        return responseFromConfig;
      } else {
        return new Response("Not found", { status: 404 });
      }
    `;
        return `export default {\n  async fetch(request, env, ctx) {${preSwitch}${pathHandlingLogic}\n    } else {`;
    });


    // 5. save temporary file
    fs.writeFileSync(tempOutputPath, workerCode, 'utf-8');
    console.log(`Successfully generated intermediate worker file: ${tempOutputPath}`);

} catch (error) {
    console.error('Error during build process:', error);
    process.exit(1);
}

#!/usr/bin/env node

// ------------------------
// Loading .env and env variables
const config = require("dotenv").config().parsed;
// Overwrite env variables anyways
for (const k in config) {
  process.env[k] = config[k];
}

// Open a URL in the default web browser
const open = require("open");

if (!process.env.NOTION_API_TOKEN) {
  open("https://www.notion.so/my-integrations");
  console.error(
    'This tool requires a valid Notion API token. Head to https://www.notion.so/my-integrations, create a new app with "Read Content" and "Insert Content" permissions, and share your Notion page with the app. Once you get a token, set NOTION_API_TOKEN env variable to the token value.'
  );
  process.exit(1);
}
if (!process.env.DEEPL_API_TOKEN) {
  open("https://www.deepl.com/pro-api");
  console.error(
    "This tool requires a DeepL API token. Head to https://www.deepl.com/pro-api, sign up, and grab your API token. Once you get a token, set DEEPL_API_TOKEN env variable to the token value."
  );
  process.exit(1);
}

// ------------------------
// DeepL API Client

const deepl = require("deepl-node");
// Note that developer account is required for this
const translator = new deepl.Translator(process.env.DEEPL_API_TOKEN);

async function translateText(richTextArray, from, to) {
  for (const item of richTextArray) {
    if (item.plain_text) {
      const result = await translator.translateText(item.plain_text, from, to);

      if (item.annotations.bold) {
        item.plain_text = ` ${result.text} `;
      } else {
        item.plain_text = result.text;
      }

      if (item.text) {
        if (item.annotations.bold) {
          item.text.content = ` ${result.text} `;
        } else {
          item.text.content = result.text;
        }
      }
    }
  }
}

// https://www.deepl.com/docs-api/translating-text/request/
const supportedFromLangs = [
  "BG", // Bulgarian
  "CS", // Czech
  "DA", // Danish
  "DE", // German
  "EL", // Greek
  "EN", // English
  "ES", // Spanish
  "ET", // Estonian
  "FI", // Finnish
  "FR", // French
  "HU", // Hungarian
  "ID", // Indonesian
  "IT", // Italian
  "JA", // Japanese
  "LT", // Lithuanian
  "LV", // Latvian
  "NL", // Dutch
  "PL", // Polish
  "PT", // Portuguese (all Portuguese varieties mixed)
  "RO", // Romanian
  "RU", // Russian
  "SK", // Slovak
  "SL", // Slovenian
  "SV", // Swedish
  "TR", // Turkish
  "ZH", // Chinese
];

const supportedToLangs = [
  "BG", // Bulgarian
  "CS", // Czech
  "DA", // Danish
  "DE", // German
  "EL", // Greek
  "EN-GB", // English (British)
  "EN-US", // English (American)
  "ES", // Spanish
  "ET", // Estonian
  "FI", // Finnish
  "FR", // French
  "HU", // Hungarian
  "ID", // Indonesian
  "IT", // Italian
  "JA", // Japanese
  "LT", // Lithuanian
  "LV", // Latvian
  "NL", // Dutch
  "PL", // Polish
  "PT-PT", // Portuguese (all Portuguese varieties excluding Brazilian Portuguese)
  "PT-BR", // Portuguese (Brazilian)
  "RO", // Romanian
  "RU", // Russian
  "SK", // Slovak
  "SL", // Slovenian
  "SV", // Swedish
  "TR", // Turkish
  "ZH", // Chinese
];

const printableSupportedFromLangs = supportedFromLangs
  .map((l) => l.toLowerCase())
  .join(",");
const printableSupportedToLangs = supportedToLangs
  .map((l) => l.toLowerCase())
  .join(",");

// ------------------------
// Utilities

if (!Array.prototype.last) {
  Array.prototype.last = function () {
    return this[this.length - 1];
  };
}

function toPrettifiedJSON(obj) {
  return JSON.stringify(obj, null, 2);
}

// Removes unnecessary block properties for new creation
function removeUnecessaryProperties(obj) {
  delete obj.id;
  delete obj.type;
  delete obj.cover;
  delete obj.created_time;
  delete obj.last_edited_time;
  delete obj.created_by;
  delete obj.last_edited_by;
}

// ------------------------
// CLI

const { Command } = require("commander");
const program = new Command();

program
  .name("notion-translator")
  .description("CLI to translate a Notion page to a different language")
  .requiredOption("-u, --url <https://www.notion.so/...>")
  .requiredOption(`-f, --from <${printableSupportedFromLangs}>`)
  .requiredOption(`-t, --to <${printableSupportedToLangs}>`)
  .option("-d, --debug");

program.showHelpAfterError();

program.parse();

const options = program.opts();
const { url, from, to, debug } = options;

if (!supportedFromLangs.includes(from.toUpperCase())) {
  console.error(
    `\nERROR: ${from.toUpperCase()} is not a supported language code.\n\nPass any of ${supportedFromLangs}\n`
  );
  process.exit(1);
}

if (!supportedToLangs.includes(to.toUpperCase())) {
  console.error(
    `\nERROR: ${to.toUpperCase()} is not a supported language code.\n\nPass any of ${supportedToLangs}\n`
  );
  process.exit(1);
}

// ------------------------
// Notion API Client

const { Client, LogLevel } = require("@notionhq/client");
const notion = new Client({
  auth: process.env.NOTION_API_TOKEN,
  logLevel: debug ? LogLevel.DEBUG : LogLevel.ERROR,
});

if (debug) {
  console.log(`Passed options: ${JSON.stringify(options, null, 2)}`);
}

// ------------------------
// Main code

async function translateBlocks(id, nestedDepth) {
  const translatedBlocks = [];
  let cursor;
  let hasMore = true;

  while (hasMore) {
    const blocks = await notion.blocks.children.list({
      block_id: id,
      start_cursor: cursor,
      page_size: 100, // max 100
    });
    if (debug) {
      console.log(
        `Fetched original blocks: ${JSON.stringify(blocks.results, null, 2)}`
      );
    }

    // Print dot for the user that is waiting for the completion
    process.stdout.write(".");

    for (const result of blocks.results) {
      let block = {
        ...result,
        block_id: result.id,
      };

      if (nestedDepth >= 2) {
        block.has_children = false;
      }

      if (nestedDepth == 1) {
        if (block.type === "column_list") {
          // If this column_list block is already in the one-level nested children,
          // its children (= column blocks) are unable to have children
          block.column_list.children = [];
          continue;
        }
      }

      if (block.type === "mention") {
        continue;
      }

      if (
        block.type === "unsupported" ||
        block.type === "child_page" ||
        block.type === "child_database"
      ) {
        if (debug) {
          console.log(
            `Fetched block is not a text we don't need to translate it: ${toPrettifiedJSON(
              block
            )}`
          );
        }

        continue;
      }

      if (block.type === "image") {
        delete block.image.type;
        delete block.image.file;
        delete block.image.external;
      }

      if (block.has_children) {
        if (nestedDepth >= 3) {
          // https://developers.notion.com/reference/patch-block-children
          // > For blocks that allow children, we allow up to two levels of nesting in a single request.
          continue;
        }
        // Recursively call this method for nested children blocks
        block[block.type].children = await translateBlocks(
          block.id,
          nestedDepth + 1
        );
      }

      removeUnecessaryProperties(block);

      // Translate all the text parts in this nest level
      for (const [k, v] of Object.entries(block)) {
        if (v instanceof Object) {
          for (const [_k, _v] of Object.entries(v)) {
            if (
              _k === "caption" ||
              (_k === "rich_text" && block.type !== "code")
            ) {
              await translateText(_v, from, to);
            }
          }
        }
      }

      if (debug) {
        console.log(`Update block request params: ${toPrettifiedJSON(block)}`);
      }

      await notion.blocks.update(block);
    }

    // For pagination
    if (blocks.has_more) {
      cursor = blocks.next_cursor;
    } else {
      hasMore = false;
    }
  }
}

async function updateTranslatedPage(originalPage) {
  const newPage = JSON.parse(JSON.stringify(originalPage)); // Create a deep copy

  newPage.page_id = originalPage.id;

  await translateText(newPage.properties.title.title, from, to);

  removeUnecessaryProperties(newPage);

  if (debug) {
    console.log(`\nUpdate page request params: ${toPrettifiedJSON(newPage)}`);
  }
  const newPageCreation = await notion.pages.update(newPage);
  if (debug) {
    console.log(`\nUpdate page response: ${toPrettifiedJSON(newPageCreation)}`);
  }
  return newPageCreation;
}

(async function () {
  let originalPage;

  const contentId = url.split("/").last().split("-").last();

  try {
    originalPage = await notion.pages.retrieve({ page_id: contentId });
  } catch (e) {
    try {
      await notion.databases.retrieve({ database_id: contentId });

      console.error(
        "\nERROR: This URL is a database. This tool currently supports only pages.\n"
      );
    } catch (_) {
      console.error(
        `\nERROR: Failed to read the page content!\n\nError details: ${e}\n\nPlease make sure the following:\n * The page is shared with your app\n * The API token is the one for this workspace\n`
      );
    }

    process.exit(1);
  }

  if (debug) {
    console.log(`\nOriginal page content: ${toPrettifiedJSON(originalPage)}\n`);
  }

  process.stdout.write(
    `\nWait a minute! Now translating the following Notion page:\n${url}\n\n(this may take some time) ...`
  );

  await updateTranslatedPage(originalPage);
  await translateBlocks(originalPage.id, 0);

  console.log(
    "... Done!\n\nDisclaimer:\nSome parts might not be perfect.\nIf the generated page is missing something, please adjust the details on your own.\n"
  );
})();

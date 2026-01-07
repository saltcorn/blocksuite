const { features } = require("@saltcorn/data/db/state");
const { escape: escapeHtml } = require("@saltcorn/markup/tags");

const verstring = features?.version_plugin_serve_path
  ? "@" + require("./package.json").version
  : "";

const processDeltaFormat = (delta = []) => {
  if (!Array.isArray(delta)) return "";
  return delta
    .map((op) => {
      if (!op?.insert) return "";
      let text = escapeHtml(String(op.insert));
      const attrs = op.attributes || {};
      if (attrs.bold) text = `<strong>${text}</strong>`;
      if (attrs.italic) text = `<em>${text}</em>`;
      if (attrs.underline) text = `<u>${text}</u>`;
      if (attrs.strikethrough) text = `<s>${text}</s>`;
      if (attrs.code) text = `<code>${text}</code>`;
      if (attrs.link)
        text = `<a href="${escapeHtml(String(attrs.link))}">${text}</a>`;
      if (attrs.color)
        text = `<span style="color:${escapeHtml(
          String(attrs.color)
        )}">${text}</span>`;
      if (attrs.background)
        text = `<span style="background-color:${escapeHtml(
          String(attrs.background)
        )}">${text}</span>`;
      return text;
    })
    .join("");
};

const processTextContent = (textData) => {
  if (!textData) return "";
  if (textData["$blocksuite:internal:text$"] && Array.isArray(textData.delta))
    return processDeltaFormat(textData.delta);
  if (typeof textData === "string") return escapeHtml(textData);
  if (textData.delta && Array.isArray(textData.delta))
    return processDeltaFormat(textData.delta);
  if (Array.isArray(textData)) return processDeltaFormat(textData);
  return escapeHtml(String(textData));
};

const renderBlock = (block, childrenHTML = "") => {
  const flavour = (block?.flavour || block?.type || "").toLowerCase();
  const props = block?.props || {};

  switch (flavour) {
    case "affine:page":
      return childrenHTML;
    case "affine:surface":
      return childrenHTML;
    case "affine:note":
      return `<section>${childrenHTML}</section>`;
    case "affine:paragraph": {
      const cls = props.type
        ? ` class="para-${escapeHtml(String(props.type))}"`
        : "";
      return `<p${cls}>${processTextContent(props.text) || childrenHTML}</p>`;
    }
    case "affine:heading": {
      const level = Math.min(
        Math.max(parseInt(String(props.type || "1")), 1),
        6
      );
      const tag = `h${level || 1}`;
      return `<${tag}>${
        processTextContent(props.text) || childrenHTML
      }</${tag}>`;
    }
    case "affine:list": {
      const isOrdered = props.type === "numbered" || props.type === "todo";
      const tag = isOrdered ? "ol" : "ul";
      const item = processTextContent(props.text) || childrenHTML;
      const todoPrefix =
        props.type === "todo" ? `${props.checked ? "✓" : "□"} ` : "";
      const nested =
        block.children && block.children.length
          ? `<li>${childrenHTML}</li>`
          : "";
      return `<${tag}><li>${todoPrefix}${item}</li>${nested}</${tag}>`;
    }
    case "affine:code": {
      const lang = props.language || "plaintext";
      return `<pre><code class="lang-${escapeHtml(
        String(lang)
      )}">${processTextContent(props.text || props.code)}</code></pre>`;
    }
    case "affine:quote":
      return `<blockquote>${
        processTextContent(props.text) || childrenHTML
      }</blockquote>`;
    case "affine:divider":
      return `<hr />`;
    case "affine:image": {
      const caption = props.caption
        ? `<figcaption>${processTextContent(props.caption)}</figcaption>`
        : "";
      const src = props.sourceId ? escapeHtml(String(props.sourceId)) : "";
      const img = src ? `<img src="${src}" alt="" />` : "";
      return `<figure>${img}${caption}</figure>`;
    }
    case "affine:bookmark": {
      const url = props.url ? escapeHtml(String(props.url)) : "";
      const title = props.title
        ? `<div>${escapeHtml(String(props.title))}</div>`
        : "";
      const desc = props.description
        ? `<div>${escapeHtml(String(props.description))}</div>`
        : "";
      const body = `${title}${desc}${childrenHTML}`;
      return url
        ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${body}</a>`
        : body;
    }
    default: {
      const text =
        processTextContent(props.text) || processTextContent(block?.text);
      return text || childrenHTML;
    }
  }
};

const renderTree = (node) => {
  if (!node) return "";
  const childrenHTML = Array.isArray(node.children)
    ? node.children.map(renderTree).join("")
    : "";
  return renderBlock(node, childrenHTML);
};

const blocksuite_json_to_html = (content) => {
  if (content == null) return "";

  let snapshot = content;
  if (typeof snapshot === "string") {
    try {
      snapshot = JSON.parse(snapshot);
    } catch (e) {
      return "";
    }
  }

  if (!snapshot || !Array.isArray(snapshot.docs)) return "";

  const pages = snapshot.docs
    .filter((d) => d && d.type === "page" && d.blocks)
    .map((doc, idx) => {
      const title = doc?.meta?.title
        ? escapeHtml(String(doc.meta.title))
        : doc?.id || `Doc ${idx + 1}`;
      const body = renderTree(doc.blocks);
      return `<section><header><h1>${title}</h1></header>${body}</section>`;
    });

  return pages.join("");
};

module.exports = {
  sc_plugin_api_version: 1,
  plugin_name: "blocksuite",
  headers: [
    {
      script: `/plugins/public/blocksuite${verstring}/js/blocksuite-core.js`,
    },
    {
      script: `/plugins/public/blocksuite${verstring}/js/blocksuite-blocks.js`,
    },
    {
      css: `/plugins/public/blocksuite${verstring}/css/blocksuite-core.css`,
    },
    {
      css: `https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.0.0/dist/themes/dark.css`,
    },
    {
      css: `https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.0.0/dist/themes/light.css`,
    },
  ],
  viewtemplates: [require("./blocksuite-view.js")],
  functions: {
    blocksuite_json_to_html: {
      description: "Convert a BlockSuite JSON value to HTML markup",
      run: blocksuite_json_to_html,
      arguments: [{ name: "content", type: "String" }],
    },
  },
};

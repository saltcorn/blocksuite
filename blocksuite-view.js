const Table = require("@saltcorn/data/models/table");
const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");
const escapeHtml = require("escape-html");
const { div, script, button, domReady, i } = require("@saltcorn/markup/tags");

// Configuration workflow: user selects the field to store the JSON
const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "Configuration",
        form: async (context) => {
          const table = await Table.findOne(context.table_id);
          const options = table
            .getFields()
            .filter((f) =>
              ["JSON", "String", "Text"].includes(f.type?.name || f.type)
            )
            .map((f) => f.name);

          return new Form({
            fields: [
              {
                name: "json_field",
                label: "BlockSuite JSON field",
                type: "String",
                attributes: { options },
                required: true,
              },
              {
                name: "read_only",
                label: "Read-only",
                type: "Bool",
              },
              {
                name: "multiple_pages",
                label: "Multiple pages",
                type: "Bool",
              },
              {
                name: "edgeless_switcher",
                label: "Show edgeless switcher",
                type: "Bool",
              },
              {
                name: "autosave",
                label: "Auto-save",
                type: "Bool",
              },
            ],
          });
        },
      },
    ],
  });

const get_state_fields = () => [];

// Run: render the editor container and client script
const run = async (
  table_id,
  viewname,
  configuration,
  state,
  extraArgs = {}
) => {
  const { req, res } = extraArgs;
  const csrfToken = req && req.csrfToken ? req.csrfToken() : "";
  const json_field = configuration.json_field;
  const table = await Table.findOne(table_id);
  const fieldName = configuration.json_field;
  const configReadOnly = !!configuration.read_only;
  const multiplePages = !!configuration.multiple_pages;
  const edgelessSwitcher = !!configuration.edgeless_switcher;
  const autosave = !!configuration.autosave;

  let row;
  try {
    row = state && state.id ? await table.getRow({ id: state.id }) : null;
  } catch (e) {
    row = null;
  }
  const rawVal = row && fieldName && row[fieldName] ? row[fieldName] : null;
  const initialJSON = rawVal ? rawVal : null;

  const user = req && req.user;
  const isOwner = table.is_owner(req.user, row || {});

  const canRead = isOwner || user.role_id <= table.min_role_read;
  if (!canRead && !configReadOnly) {
    return "";
  }

  const canWrite = isOwner || user.role_id <= table.min_role_write;
  const effectiveReadOnly = configReadOnly || !canWrite;

  const rnd = 0;
  const saveBtnId = `blocksuite-save-${rnd}`;

  return (
    div(
      {
        id: "toolbar",
        class: "d-flex gap-2 align-items-center mb-2 p-2 border-bottom",
      },
      button(
        {
          id: "btn-undo",
          class: "btn btn-outline-secondary btn-sm",
          title: "Undo",
        },
        "↩"
      ),
      button(
        {
          id: "btn-redo",
          class: "btn btn-outline-secondary btn-sm",
          title: "Redo",
        },
        "↪"
      ),
      edgelessSwitcher
        ? button(
            {
              id: "btn-switch-editor",
              class: "btn btn-outline-secondary btn-sm",
              title: "Switch Editor Mode",
            },
            "⇄"
          )
        : "",
      !effectiveReadOnly && multiplePages
        ? button(
            { id: "btn-new-doc", class: "btn btn-primary btn-sm" },
            "+ New Doc"
          )
        : "",
      multiplePages
        ? div({ class: "border-start mx-2", style: "height: 20px;" }) +
            div({ id: "doc-list", class: "d-flex gap-1 flex-wrap" })
        : "",
      div({ class: "ms-auto" }) +
        div(
          {
            id: "save-icon",
            style: "display: none;",
            title: "Saved",
          },
          i({ class: "fas fa-save" })
        )
    ) +
    div({ id: "affine-editor-container", style: "height: 70vh;" }) +
    (!effectiveReadOnly && (!autosave || !state?.id)
      ? button(
          { id: saveBtnId, class: "btn btn-primary mt-2", type: "button" },
          "Save"
        )
      : "") +
    script(
      domReady(/*javascript*/ `
    (async () => {
      const docListEl = document.getElementById('doc-list');
      const btnNewDoc = document.getElementById('btn-new-doc');
      const btnSwitchEditor = document.getElementById('btn-switch-editor');
      const btnUndo = document.getElementById('btn-undo');
      const btnRedo = document.getElementById('btn-redo');
      const editorContainer = document.getElementById('affine-editor-container');
      const saveBtn = document.getElementById('${saveBtnId}');

      const readOnly = ${effectiveReadOnly ? "true" : "false"};
      const multiplePages = ${multiplePages ? "true" : "false"};
      const autosave = ${autosave ? "true" : "false"};

      try {
        const bs = window.blocksuite || window.BlockSuite || window.Affine || {};
        if (!bs.presets || !bs.store || !bs.blocks) {
          return;
        }

        const presets = bs.presets;
        const store = bs.store;
        const blocks = bs.blocks;
        const AffineEditorContainer = presets.AffineEditorContainer;
        const PageEditor = presets.PageEditor;
        const EdgelessEditor = presets.EdgelessEditor;
        const DocCollection = store.DocCollection;
        const Schema = store.Schema;
        const Text = store.Text;
        const Job = store.Job;

        if (!AffineEditorContainer || !DocCollection || !Schema || !Text || !Job) {
          return;
        }

        const schema = new Schema().register(blocks.AffineSchemas);
        const collection = new DocCollection({ schema });
        collection.meta.initialize();
        const job = new Job({ collection });

        let activeDocId = null;
        let editor = null;
        let currentEditorMode = 'page'; // 'page' or 'edgeless'
        let currentId = '${state?.id || ""}';
        const html = document.documentElement;
        const userTheme = (window._sc_lightmode === 'dark') ? 'dark' : 'light';
        if (userTheme === 'dark') {
          html.setAttribute('data-theme', 'dark');
          html.classList.remove('light', 'sl-theme-light');
          html.classList.add('dark', 'sl-theme-dark');
        } else {
          html.removeAttribute('data-theme');
          html.classList.remove('dark', 'sl-theme-dark');
          html.classList.add('light', 'sl-theme-light');
        }

        if (btnUndo && !readOnly) {
          btnUndo.onclick = () => {
            if (activeDocId) {
              const doc = collection.getDoc(activeDocId);
              if (doc) doc.undo();
            }
          };
        }

        if (btnRedo && !readOnly) {
          btnRedo.onclick = () => {
            if (activeDocId) {
              const doc = collection.getDoc(activeDocId);
              if (doc) doc.redo();
            }
          };
        }

        if (btnSwitchEditor) {
          btnSwitchEditor.onclick = () => {
            currentEditorMode = currentEditorMode === 'page' ? 'edgeless' : 'page';
            if (activeDocId) {
              const doc = collection.getDoc(activeDocId);
              mountEditor(doc);
            }
          };
        }

        function mountEditor(doc) {
          if (!doc) return;
          activeDocId = doc.id;
          editorContainer.innerHTML = '';
          
          if (currentEditorMode === 'edgeless') {
            editor = new EdgelessEditor();
          } else {
            // editor = new PageEditor();
            editor = new AffineEditorContainer();
          }
          
          editor.doc = doc;
          editorContainer.appendChild(editor);

          if (readOnly && editorContainer) {
            const stopEvent = (e) => {
              e.preventDefault();
              e.stopPropagation();
            };

            editorContainer.addEventListener('beforeinput', stopEvent, { capture: true });
            editorContainer.addEventListener('paste', stopEvent, { capture: true });
            editorContainer.addEventListener('cut', stopEvent, { capture: true });
            editorContainer.addEventListener('drop', stopEvent, { capture: true });
            editorContainer.addEventListener(
              'keydown',
              (e) => {
                const navKeys = [
                  'ArrowUp',
                  'ArrowDown',
                  'ArrowLeft',
                  'ArrowRight',
                  'PageUp',
                  'PageDown',
                  'Home',
                  'End',
                  'Tab',
                  'Shift',
                  'Control',
                  'Alt',
                  'Meta',
                  'Escape',
                  'F5',
                ];
                const isNav =
                  navKeys.includes(e.key) ||
                  e.key.startsWith('F') ||
                  e.ctrlKey ||
                  e.metaKey ||
                  e.altKey;
                if (!isNav) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              },
              { capture: true }
            );
          }
          renderDocList();
        }

        function initDoc(doc, titleText) {
          if (!doc) return;
          doc.load(() => {
            const pageBlockId = doc.addBlock('affine:page', {
              title: new Text(titleText || 'Untitled'),
            });
            doc.addBlock('affine:surface', {}, pageBlockId);
            const noteId = doc.addBlock('affine:note', {}, pageBlockId);
            doc.addBlock('affine:paragraph', {}, noteId);
          });
        }

        function renderDocList() {
          if (!docListEl) return;
          docListEl.innerHTML = '';
          const docMetas = collection.meta.docMetas || [];
          docMetas.forEach((meta) => {
            const btn = document.createElement('button');
            btn.textContent = meta.title || meta.id;
            btn.className = 'btn btn-sm ' + (activeDocId === meta.id ? 'btn-secondary' : 'btn-outline-secondary');
            btn.onclick = () => {
              const targetDoc = collection.getDoc(meta.id);
              if (!targetDoc) return;
              mountEditor(targetDoc);
            };
            docListEl.appendChild(btn);
          });
        }

        async function loadInitialDocs() {
          const raw = ${JSON.stringify(initialJSON)};
          let parsed = raw;
          if (typeof parsed === 'string') {
            try {
              parsed = JSON.parse(parsed);
            } catch (err) {
              console.warn('Failed to parse stored BlockSuite JSON', err);
              parsed = null;
            }
          }
          if (parsed && parsed.docs && Array.isArray(parsed.docs) && parsed.docs.length) {
            for (const snapshot of parsed.docs) {
              try {
                await job.snapshotToDoc(snapshot);
              } catch (err) {
                console.warn('Failed to hydrate doc snapshot', err);
              }
            }
            return true;
          }
          return false;
        }

        const hydrated = await loadInitialDocs();
        if (!hydrated) {
          const seedDoc = collection.createDoc({ id: 'page1' });
          initDoc(seedDoc, 'Untitled');
        }

        const initialMeta = (collection.meta.docMetas || [])[0];
        if (initialMeta) {
          mountEditor(collection.getDoc(initialMeta.id));
        } else {
          editorContainer.innerHTML = '<div class="text-muted">No documents yet.</div>';
        }

        if (btnNewDoc && !readOnly && multiplePages) {
          btnNewDoc.onclick = () => {
            const docCount = (collection.meta.docMetas || []).length + 1;
            const id = 'page' + docCount;
            const doc = collection.createDoc({ id });
            initDoc(doc, 'Page ' + docCount);
            mountEditor(doc);
          };
        }

        const saveIconEl = document.getElementById('save-icon');
        let saveTimeout = null;
        let autoSaveTimeout = null;
        let domObserver = null;

        const scheduleAutoSave = () => {
          // Avoid creating multiple new rows: only autosave once we
          // have a currentId (i.e. after the first explicit save).
          if (!autosave || readOnly || !currentId) return;
          clearTimeout(autoSaveTimeout);
          autoSaveTimeout = setTimeout(() => {
            performSave();
          }, 1000);
        };

        async function performSave() {
          try {
            const docMetas = collection.meta.docMetas || [];
            const snapshots = [];
            for (const meta of docMetas) {
              const doc = collection.getDoc(meta.id);
              if (!doc) continue;
              doc.load();
              snapshots.push(await job.docToSnapshot(doc));
            }
            const payload = {
              docs: snapshots,
              info: job.collectionInfoToSnapshot(),
            };

            const saveUrl = '/view/${viewname}/save';
            const response = await fetch(saveUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'CSRF-Token': '${csrfToken}',
              },
              body: JSON.stringify({
                id: currentId,
                content: payload,
                field: '${json_field}',
              }),
            });

            if (response.redirected) {
              window.location.href = response.url;
              return;
            }

            const result = await response.json();

            if (!response.ok) {
              throw new Error(result.error || 'Save failed');
            }

            if (result.id) {
              if (autosave && saveBtn) {
                saveBtn.classList.add('d-none');
              }
            }

            if (saveIconEl) {
              saveIconEl.style.display = 'block';
              clearTimeout(saveTimeout);
              saveTimeout = setTimeout(() => {
                saveIconEl.style.display = 'none';
              }, 1000);
            }
          } catch (error) {
            console.error('Save error:', error);
          }
        }

        if (autosave && !readOnly && editorContainer) {
          editorContainer.addEventListener('input', scheduleAutoSave);
          editorContainer.addEventListener('beforeinput', scheduleAutoSave);
          editorContainer.addEventListener('change', scheduleAutoSave);

          domObserver = new MutationObserver(() => scheduleAutoSave());
          domObserver.observe(editorContainer, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        }

        if (autosave && !readOnly) {
          const slotHandler = () => scheduleAutoSave();
          collection.slots.docAdded?.subscribe(slotHandler);
          collection.slots.docUpdated?.subscribe(slotHandler);
        }

        if (saveBtn && !readOnly) saveBtn.addEventListener('click', async () => {
          await performSave();
          saveBtn.disabled = false;
        });

      } catch (error) {
        console.error('Editor initialization error:', error);
      }
    })();  
    `)
    )
  );
};

const save = async (table_id, viewname, config, body, { req, res }) => {
  try {
    const id = body.id;
    const content = body.content;

    const table = await Table.findOne(table_id);
    if (!table) throw new Error("Table not found");

    const fieldName = body.field || config.json_field;
    if (!fieldName) throw new Error("Field name not specified");

    const update = {};
    update[fieldName] = content;
    //typeof content === "object" ? JSON.stringify(content) : content;

    let newId = id;
    if (id) {
      await table.updateRow(update, id, req.user);
    } else {
      newId = await table.insertRow(update, req.user);
    }

    //req.flash("success", req.__("Saved successfully"));
    //res.redirect(`/table/${table.id}`);
    if (newId !== id) {
      res.redirect(`/view/${viewname}?id=${newId}`);
      return;
    }
  } catch (err) {
    console.error(err);
    return { json: { error: err.message }, status: 500 };
  }
};

module.exports = {
  name: "BlockSuiteDocument",
  display_state_form: false,
  configuration_workflow,
  get_state_fields,
  run,
  routes: { save },
  functions: () => {
    return {
      blocksuite_json_to_html: {
        run: (content) => {
          if (!content) return "";

          let parsed = content;
          if (typeof parsed === "string") {
            try {
              parsed = JSON.parse(parsed);
            } catch (e) {
              return `<pre>${escapeHtml(parsed)}</pre>`;
            }
          }

          try {
            const pretty = JSON.stringify(parsed, null, 2);
            return `<pre>${escapeHtml(pretty)}</pre>`;
          } catch (e) {
            return `<pre>${escapeHtml(String(parsed))}</pre>`;
          }
        },
        isAsync: false,
        description: "Convert a BlockSuite JSON document to escaped HTML",
        arguments: [{ name: "content", type: "String" }],
      },
    };
  },
};

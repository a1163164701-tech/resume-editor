const STORAGE_KEY = "resume-editor-blank-template-v2";

const originalResume = {
  title: "我的简历",
  avatar: "./assets/avatar-placeholder.svg",
  sectionTitles: {
    basic: "个人信息",
    education: "教育经历",
    work: "工作经历",
    projects: "项目经历",
    skills: "专业技能",
  },
  fieldLabels: {
    basic: {
      name: "姓名",
      birthDate: "出生年月",
      gender: "性别",
      phone: "电话",
      email: "邮箱",
      jobTarget: "求职意向",
      salary: "期望薪资",
    },
    education: {
      school: "学校",
      degree: "学历",
      major: "专业",
      start: "开始年份",
      end: "结束年份",
      description: "主修课程 / 描述",
    },
    work: {
      company: "公司",
      role: "职位",
      start: "开始时间",
      end: "结束时间",
      description: "工作内容",
    },
    projects: {
      name: "项目类型",
      subtitle: "项目名称",
      start: "开始时间",
      end: "结束时间",
      description: "项目内容",
    },
    skills: {
      content: "技能内容",
    },
  },
  sectionOrder: ["education", "work", "projects", "skills"],
  layout: {
    fontSize: 9.4,
    lineHeight: 1.48,
    sectionGap: 3.5,
    headingSize: 15.5,
    pageMargin: 9,
    headingColor: "#111111",
  },
  basic: {
    name: "",
    birthDate: "",
    gender: "",
    phone: "",
    email: "",
    jobTarget: "",
    salary: "",
  },
  education: [
    {
      school: "",
      degree: "",
      major: "",
      start: "",
      end: "",
      description: "",
    },
  ],
  work: [
    {
      company: "",
      role: "",
      start: "",
      end: "",
      description: "",
    },
  ],
  projects: [
    {
      name: "",
      subtitle: "",
      start: "",
      end: "",
      description: "",
    },
  ],
  skills: "",
};

let state = loadState();
let saveTimer = null;
let zoom = 0.9;
let draggedSectionKey = null;

const sectionPreviewIds = {
  education: "previewEducation",
  work: "previewWork",
  projects: "previewProjects",
  skills: "previewSkills",
};

const layoutUnits = {
  fontSize: "pt",
  lineHeight: "",
  sectionGap: "mm",
  headingSize: "pt",
  pageMargin: "mm",
};

const form = document.querySelector("#resumeForm");
const resumeTitle = document.querySelector("#resumeTitle");
const saveStatus = document.querySelector("#saveStatus");
const saveState = document.querySelector(".save-state");
const importDialog = document.querySelector("#importDialog");
const resumeImportInput = document.querySelector("#resumeImportInput");
const importStatus = document.querySelector("#importStatus");
const importResults = document.querySelector("#importResults");
const importExtractedText = document.querySelector("#importExtractedText");
const applyImportButton = document.querySelector("#applyImport");
const rerunRecognitionButton = document.querySelector("#rerunRecognition");
let currentImportRecognition = null;
let currentImportFile = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return clone(originalResume);
    const parsed = JSON.parse(saved);
    const base = clone(originalResume);
    return {
      ...base,
      ...parsed,
      basic: { ...base.basic, ...(parsed.basic || {}) },
      sectionTitles: { ...base.sectionTitles, ...(parsed.sectionTitles || {}) },
      fieldLabels: Object.fromEntries(
        Object.entries(base.fieldLabels).map(([key, labels]) => [
          key,
          { ...labels, ...(parsed.fieldLabels?.[key] || {}) },
        ]),
      ),
      layout: { ...base.layout, ...(parsed.layout || {}) },
      sectionOrder:
        Array.isArray(parsed.sectionOrder) && parsed.sectionOrder.length === base.sectionOrder.length
          ? parsed.sectionOrder.filter((key) => base.sectionOrder.includes(key))
          : base.sectionOrder,
    };
  } catch {
    return clone(originalResume);
  }
}

function getAtPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setAtPath(object, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  const target = parts.reduce((value, key) => value[key], object);
  target[last] = value;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hasAnyValue(item) {
  return Object.values(item).some((value) => String(value || "").trim());
}

function sectionHasContent(key) {
  if (key === "skills") return Boolean(String(state.skills || "").trim());
  return state[key].some(hasAnyValue);
}

function resumeHasAnyContent() {
  const hasBasicContent = Object.values(state.basic).some((value) => String(value || "").trim());
  const hasSectionContent = ["education", "work", "projects"].some((key) => state[key].some(hasAnyValue));
  const hasSkills = Boolean(String(state.skills || "").trim());
  const hasAvatar = Boolean(state.avatar && state.avatar !== "./assets/avatar-placeholder.svg");
  return hasBasicContent || hasSectionContent || hasSkills || hasAvatar;
}

function renderLabeledLines(text) {
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^：:]{1,36}[：:])\s*(.*)$/);
      if (!match) return `<p class="labeled-line">${escapeHtml(line)}</p>`;
      return `<p class="labeled-line"><strong>${escapeHtml(match[1])}</strong> ${escapeHtml(match[2])}</p>`;
    })
    .join("");
}

function calculateAge(value) {
  if (!value) return "";
  const [year, month] = value.split("-").map(Number);
  if (!year) return "";
  const today = new Date();
  let age = today.getFullYear() - year;
  if ((month || 1) > today.getMonth() + 1) age -= 1;
  return age > 0 ? `${age}岁` : "";
}

function formatMonth(value) {
  return value ? value.replace("-", ".") : "";
}

function markSaving() {
  saveState.classList.add("saving");
  saveStatus.textContent = "正在保存…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveState.classList.remove("saving");
    saveStatus.textContent = "草稿已保存";
  }, 550);
}

function bindStaticFields() {
  resumeTitle.value = state.title;
  resumeTitle.addEventListener("input", () => {
    state.title = resumeTitle.value;
    markSaving();
  });

  form.querySelectorAll("[data-path]").forEach((input) => {
    input.value = getAtPath(state, input.dataset.path) ?? "";
    input.addEventListener("input", () => {
      setAtPath(state, input.dataset.path, input.value);
      renderPreview();
      markSaving();
    });
  });
}

function sectionTitle(key) {
  return state.sectionTitles[key]?.trim() || originalResume.sectionTitles[key];
}

function fieldLabel(path) {
  return getAtPath(state.fieldLabels, path)?.trim() || getAtPath(originalResume.fieldLabels, path);
}

function syncSectionTitleLabels() {
  Object.keys(originalResume.sectionTitles).forEach((key) => {
    document.querySelectorAll(`[data-section-label="${key}"]`).forEach((element) => {
      element.textContent = sectionTitle(key);
    });
    document.querySelectorAll(`[data-editor-title="${key}"]`).forEach((element) => {
      element.textContent = sectionTitle(key);
    });
    document.querySelectorAll(`[data-sort-label="${key}"]`).forEach((element) => {
      element.textContent = sectionTitle(key);
    });
    document.querySelectorAll(`[data-repeat-title="${key}"]`).forEach((element) => {
      element.textContent = sectionTitle(key);
    });
  });
}

function syncFieldLabels() {
  document.querySelectorAll("[data-field-label-display]").forEach((element) => {
    element.textContent = fieldLabel(element.dataset.fieldLabelDisplay);
  });
}

function formatLayoutValue(key, value) {
  if (key === "lineHeight") return `${Number(value).toFixed(2)}×`;
  const number = Number(value);
  const formatted = Number.isInteger(number) ? number.toFixed(0) : number.toFixed(1);
  return `${formatted}${layoutUnits[key] || ""}`;
}

function applyLayout() {
  const paper = document.querySelector("#resumePaper");
  paper.style.setProperty("--resume-font-size", `${state.layout.fontSize}pt`);
  paper.style.setProperty("--resume-line-height", state.layout.lineHeight);
  paper.style.setProperty("--resume-section-gap", `${state.layout.sectionGap}mm`);
  paper.style.setProperty("--resume-heading-size", `${state.layout.headingSize}pt`);
  paper.style.setProperty("--resume-page-margin", `${state.layout.pageMargin}mm`);
  paper.style.setProperty("--resume-heading-color", state.layout.headingColor);

  document.querySelectorAll("[data-output-for]").forEach((output) => {
    const key = output.dataset.outputFor;
    output.value = formatLayoutValue(key, state.layout[key]);
    output.textContent = formatLayoutValue(key, state.layout[key]);
  });
}

function bindCustomizationControls() {
  document.querySelectorAll("[data-title-key]").forEach((input) => {
    const key = input.dataset.titleKey;
    input.value = state.sectionTitles[key] ?? "";
    input.addEventListener("input", () => {
      const previousTitle = sectionTitle(key);
      const currentSkillsLabel = fieldLabel("skills.content");
      state.sectionTitles[key] = input.value;

      if (
        key === "skills" &&
        (currentSkillsLabel === originalResume.fieldLabels.skills.content ||
          currentSkillsLabel === `${previousTitle}内容`)
      ) {
        state.fieldLabels.skills.content = `${sectionTitle("skills")}内容`;
        const skillsLabelInput = document.querySelector('[data-field-label-input="skills.content"]');
        if (skillsLabelInput) skillsLabelInput.value = state.fieldLabels.skills.content;
      }

      syncSectionTitleLabels();
      syncFieldLabels();
      renderSectionOrderEditor();
      renderPreview();
      markSaving();
    });
  });

  document.querySelectorAll("[data-field-label-input]").forEach((input) => {
    const path = input.dataset.fieldLabelInput;
    input.value = getAtPath(state.fieldLabels, path) ?? getAtPath(originalResume.fieldLabels, path);
    input.addEventListener("input", () => {
      setAtPath(state.fieldLabels, path, input.value);
      syncFieldLabels();
      renderPreview();
      markSaving();
    });
  });

  document.querySelectorAll("[data-layout-key]").forEach((input) => {
    const key = input.dataset.layoutKey;
    input.value = state.layout[key];
    input.addEventListener("input", () => {
      state.layout[key] = input.type === "color" ? input.value : Number(input.value);
      applyLayout();
      markSaving();
    });
  });

  document.querySelector("#resetLayoutButton").addEventListener("click", () => {
    state.layout = clone(originalResume.layout);
    document.querySelectorAll("[data-layout-key]").forEach((input) => {
      input.value = state.layout[input.dataset.layoutKey];
    });
    applyLayout();
    markSaving();
  });
}

function applySectionOrder() {
  const previewSections = document.querySelector("#previewSections");
  state.sectionOrder.forEach((key) => {
    const element = document.querySelector(`#${sectionPreviewIds[key]}`);
    if (element) previewSections.appendChild(element);
  });
}

function moveSection(key, direction) {
  const currentIndex = state.sectionOrder.indexOf(key);
  const nextIndex = currentIndex + direction;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= state.sectionOrder.length) return;
  const nextOrder = [...state.sectionOrder];
  [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
  state.sectionOrder = nextOrder;
  applySectionOrder();
  renderSectionOrderEditor();
  markSaving();
}

function reorderSection(draggedKey, targetKey) {
  if (!draggedKey || draggedKey === targetKey) return;
  const nextOrder = [...state.sectionOrder];
  const fromIndex = nextOrder.indexOf(draggedKey);
  const targetIndex = nextOrder.indexOf(targetKey);
  if (fromIndex < 0 || targetIndex < 0) return;
  nextOrder.splice(fromIndex, 1);
  nextOrder.splice(targetIndex, 0, draggedKey);
  state.sectionOrder = nextOrder;
  applySectionOrder();
  renderSectionOrderEditor();
  markSaving();
}

function renderSectionOrderEditor() {
  const container = document.querySelector("#sectionOrderEditor");
  container.innerHTML = state.sectionOrder
    .map(
      (key, index) => `
        <div class="sort-item" draggable="true" data-sort-key="${key}">
          <span class="drag-handle" aria-hidden="true">⋮⋮</span>
          <span class="sort-label" data-sort-label="${key}">${escapeHtml(sectionTitle(key))}</span>
          <span class="sort-actions">
            <button data-move-up="${key}" type="button" aria-label="上移${escapeHtml(sectionTitle(key))}" ${index === 0 ? "disabled" : ""}>↑</button>
            <button data-move-down="${key}" type="button" aria-label="下移${escapeHtml(sectionTitle(key))}" ${index === state.sectionOrder.length - 1 ? "disabled" : ""}>↓</button>
          </span>
        </div>`,
    )
    .join("");

  container.querySelectorAll("[data-move-up]").forEach((button) => {
    button.addEventListener("click", () => moveSection(button.dataset.moveUp, -1));
  });
  container.querySelectorAll("[data-move-down]").forEach((button) => {
    button.addEventListener("click", () => moveSection(button.dataset.moveDown, 1));
  });

  container.querySelectorAll(".sort-item").forEach((item) => {
    item.addEventListener("dragstart", (event) => {
      draggedSectionKey = item.dataset.sortKey;
      item.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedSectionKey);
    });
    item.addEventListener("dragover", (event) => {
      if (!draggedSectionKey || draggedSectionKey === item.dataset.sortKey) return;
      event.preventDefault();
      item.classList.add("drag-over");
      event.dataTransfer.dropEffect = "move";
    });
    item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      item.classList.remove("drag-over");
      reorderSection(draggedSectionKey, item.dataset.sortKey);
    });
    item.addEventListener("dragend", () => {
      draggedSectionKey = null;
      container.querySelectorAll(".sort-item").forEach((row) => {
        row.classList.remove("dragging", "drag-over");
      });
    });
  });
}

function renderRepeatEditor(type, containerId, templateId) {
  const container = document.querySelector(`#${containerId}`);
  const template = document.querySelector(`#${templateId}`);
  container.replaceChildren();

  state[type].forEach((item, index) => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".repeat-card");
    card.querySelectorAll("[data-key]").forEach((input) => {
      input.value = item[input.dataset.key] ?? "";
      input.addEventListener("input", () => {
        state[type][index][input.dataset.key] = input.value;
        renderPreview();
        markSaving();
      });
    });
    card.querySelector(".remove-button").addEventListener("click", () => {
      if (state[type].length === 1) return;
      state[type].splice(index, 1);
      renderEditors();
      renderPreview();
      markSaving();
    });
    container.appendChild(fragment);
  });
}

function renderEditors() {
  renderRepeatEditor("education", "educationEditor", "educationItemTemplate");
  renderRepeatEditor("work", "workEditor", "workItemTemplate");
  renderRepeatEditor("projects", "projectEditor", "projectItemTemplate");
  syncSectionTitleLabels();
  syncFieldLabels();
}

function renderPreview() {
  document.querySelector("#previewName").textContent = state.basic.name || fieldLabel("basic.name");

  const contacts = [
    state.basic.gender,
    calculateAge(state.basic.birthDate),
    state.basic.phone,
    state.basic.email,
  ].filter(Boolean);

  document.querySelector("#previewContacts").innerHTML = contacts
    .map((item, index) => {
      const icon = index === contacts.length - 2 ? "☎" : index === contacts.length - 1 ? "✉" : "";
      return `<span class="contact-item">${icon ? `<span class="contact-icon">${icon}</span>` : ""}${escapeHtml(item)}</span>`;
    })
    .join('<span aria-hidden="true">|</span>');

  const targetParts = [];
  if (state.basic.jobTarget) targetParts.push(`${fieldLabel("basic.jobTarget")}：${state.basic.jobTarget}`);
  if (state.basic.salary) targetParts.push(`${fieldLabel("basic.salary")}：${state.basic.salary}`);
  document.querySelector("#previewTarget").textContent = targetParts.join(" | ");

  const avatar = state.avatar || "./assets/avatar-placeholder.svg";
  const previewAvatar = document.querySelector("#previewAvatar");
  const hasCustomAvatar = Boolean(state.avatar && state.avatar !== "./assets/avatar-placeholder.svg");
  previewAvatar.src = avatar;
  previewAvatar.hidden = !hasCustomAvatar;
  document.querySelector("#editorAvatar").src = avatar;

  document.querySelector("#previewEducation").innerHTML = `
    <h2 class="resume-section-title">${escapeHtml(sectionTitle("education"))}</h2>
    ${state.education
      .filter(hasAnyValue)
      .map(
        (item) => `
          <article class="resume-entry">
            <div class="entry-header">
              <strong>${escapeHtml(item.school)}</strong>
              <span class="entry-meta">${escapeHtml([item.degree, item.major].filter(Boolean).join("　　"))}</span>
              <span class="entry-date">${escapeHtml([item.start, item.end].filter(Boolean).join("-"))}</span>
            </div>
            <p class="entry-description">${escapeHtml(item.description)}</p>
          </article>`,
      )
      .join("")}
  `;

  document.querySelector("#previewWork").innerHTML = `
    <h2 class="resume-section-title">${escapeHtml(sectionTitle("work"))}</h2>
    ${state.work
      .filter(hasAnyValue)
      .map(
        (item) => `
          <article class="resume-entry">
            <div class="entry-header">
              <strong>${escapeHtml(item.company)}</strong>
              <span class="entry-meta">${escapeHtml(item.role)}</span>
              <span class="entry-date">${escapeHtml([formatMonth(item.start), formatMonth(item.end)].filter(Boolean).join("-"))}</span>
            </div>
            <div class="labeled-lines">${renderLabeledLines(item.description)}</div>
          </article>`,
      )
      .join("")}
  `;

  document.querySelector("#previewProjects").innerHTML = `
    <h2 class="resume-section-title">${escapeHtml(sectionTitle("projects"))}</h2>
    ${state.projects
      .filter(hasAnyValue)
      .map(
        (item) => `
          <article class="resume-entry">
            <div class="entry-header">
              <strong>${escapeHtml(item.name)}</strong>
              <span class="entry-meta">${escapeHtml(item.subtitle)}</span>
              <span class="entry-date">${escapeHtml([formatMonth(item.start), formatMonth(item.end)].filter(Boolean).join("-"))}</span>
            </div>
            <div class="labeled-lines">${renderLabeledLines(item.description)}</div>
          </article>`,
      )
      .join("")}
  `;

  document.querySelector("#previewSkills").innerHTML = `
    <h2 class="resume-section-title">${escapeHtml(sectionTitle("skills"))}</h2>
    <div class="skills-block labeled-lines">${renderLabeledLines(state.skills)}</div>
  `;

  syncSectionTitleLabels();
  syncFieldLabels();
  applySectionOrder();
  applyLayout();
  Object.keys(sectionPreviewIds).forEach((key) => {
    document.querySelector(`#${sectionPreviewIds[key]}`).classList.toggle("is-empty", !sectionHasContent(key));
  });
  document.querySelector("#resumePaper").classList.toggle("is-blank-resume", !resumeHasAnyContent());
}

function addItem(type) {
  const emptyItems = {
    education: {
      school: "",
      degree: "",
      major: "",
      start: "",
      end: "",
      description: "",
    },
    work: {
      company: "",
      role: "",
      start: "",
      end: "",
      description: "",
    },
    projects: {
      name: "",
      subtitle: "",
      start: "",
      end: "",
      description: "",
    },
  };
  state[type].push(clone(emptyItems[type]));
  renderEditors();
  renderPreview();
  markSaving();
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setImportStatus(title, description, isError = false) {
  importStatus.hidden = false;
  importResults.hidden = true;
  importStatus.classList.toggle("is-error", isError);
  importStatus.querySelector("strong").textContent = title;
  importStatus.querySelector("p").textContent = description;
  document.querySelector("#retryImportFile").hidden = !isError;
  applyImportButton.disabled = true;
  rerunRecognitionButton.hidden = true;
}

function renderRecognitionSummary(recognition) {
  const { summary } = recognition;
  const stats = [
    ["个人信息", summary.basicFields],
    ["教育经历", summary.educationEntries],
    ["工作经历", summary.workEntries],
    ["项目经历", summary.projectEntries],
    ["技能条目", summary.skillLines],
    ["头像", recognition.avatar ? 1 : 0],
  ];
  document.querySelector("#recognitionStats").innerHTML = stats
    .map(
      ([label, value]) => `
        <div class="recognition-stat">
          <strong>${Number(value) || 0}</strong>
          <span>${label}</span>
        </div>`,
    )
    .join("");

  const recognitionScore =
    summary.basicFields +
    summary.educationEntries * 2 +
    summary.workEntries * 2 +
    summary.projectEntries +
    Math.min(summary.skillLines, 3);
  const quality = document.querySelector("#recognitionQuality");
  quality.textContent = recognitionScore >= 7 ? "识别较完整" : "建议检查";
}

function showImportRecognition(file, text, recognition) {
  currentImportFile = file;
  currentImportRecognition = recognition;
  importStatus.hidden = true;
  importResults.hidden = false;
  importExtractedText.value = text;
  document.querySelector("#importFileName").textContent = file?.name || "粘贴的简历文字";
  document.querySelector("#importFileMeta").textContent = [
    file?.name?.split(".").pop()?.toUpperCase(),
    file ? formatFileSize(file.size) : "",
    `${text.length} 个字符`,
  ]
    .filter(Boolean)
    .join(" · ");
  renderRecognitionSummary(recognition);
  applyImportButton.disabled = false;
  rerunRecognitionButton.hidden = false;
}

async function processImportFile(file) {
  if (!file) return;
  if (!importDialog.open) importDialog.showModal();
  setImportStatus("正在读取简历…", "文件只在当前浏览器中解析，请稍候。");
  currentImportFile = file;
  currentImportRecognition = null;

  try {
    const extracted = await window.ResumeImporter.extractResume(file);
    const text = extracted.text;
    const recognition = window.ResumeImporter.recognizeResumeText(text);
    recognition.avatar = extracted.avatar || "";
    showImportRecognition(file, text, recognition);
  } catch (error) {
    setImportStatus(
      "未能识别这份简历",
      error?.message || "请换用可复制文字的 PDF、DOCX、TXT 或 Markdown 文件。",
      true,
    );
  } finally {
    resumeImportInput.value = "";
  }
}

function entriesForImport(items, emptyTemplate) {
  const populated = (items || []).filter(hasAnyValue).map(clone);
  return populated.length ? populated : [clone(emptyTemplate)];
}

function mergeImportedEntries(currentItems, importedItems, emptyTemplate) {
  const existing = (currentItems || []).filter(hasAnyValue).map(clone);
  const imported = (importedItems || []).filter(hasAnyValue).map(clone);
  const merged = [...existing, ...imported];
  return merged.length ? merged : [clone(emptyTemplate)];
}

function refreshEditorFromState() {
  resumeTitle.value = state.title;
  form.querySelectorAll("[data-path]").forEach((input) => {
    input.value = getAtPath(state, input.dataset.path) ?? "";
  });
  document.querySelectorAll("[data-title-key]").forEach((input) => {
    input.value = state.sectionTitles[input.dataset.titleKey] ?? "";
  });
  document.querySelectorAll("[data-field-label-input]").forEach((input) => {
    input.value =
      getAtPath(state.fieldLabels, input.dataset.fieldLabelInput) ??
      getAtPath(originalResume.fieldLabels, input.dataset.fieldLabelInput);
  });
  renderEditors();
  renderSectionOrderEditor();
  renderPreview();
}

function applyImportedResume(recognition, mode) {
  if (mode === "merge") {
    Object.entries(recognition.basic).forEach(([key, value]) => {
      if (!state.basic[key] && value) state.basic[key] = value;
    });
    state.education = mergeImportedEntries(
      state.education,
      recognition.education,
      originalResume.education[0],
    );
    state.work = mergeImportedEntries(state.work, recognition.work, originalResume.work[0]);
    state.projects = mergeImportedEntries(
      state.projects,
      recognition.projects,
      originalResume.projects[0],
    );
    state.skills = [state.skills, recognition.skills].filter((value) => String(value || "").trim()).join("\n");
    if (
      (!state.avatar || state.avatar === originalResume.avatar) &&
      recognition.avatar
    ) {
      state.avatar = recognition.avatar;
    }
  } else {
    state.basic = { ...clone(originalResume.basic), ...clone(recognition.basic) };
    state.education = entriesForImport(recognition.education, originalResume.education[0]);
    state.work = entriesForImport(recognition.work, originalResume.work[0]);
    state.projects = entriesForImport(recognition.projects, originalResume.projects[0]);
    state.skills = recognition.skills || "";
    state.avatar = recognition.avatar || originalResume.avatar;
  }

  if (
    recognition.basic.name &&
    (!state.title.trim() || state.title === originalResume.title || mode === "replace")
  ) {
    state.title = `${recognition.basic.name}的简历`;
  }

  refreshEditorFromState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  saveState.classList.remove("saving");
  saveStatus.textContent = "简历已导入";
  importDialog.close();
  document.querySelector(".editor-panel").scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-add]").forEach((button) => {
  button.addEventListener("click", () => addItem(button.dataset.add));
});

document.querySelector("#importResumeButton").addEventListener("click", () => {
  resumeImportInput.click();
});

document.querySelector("#chooseAnotherResume").addEventListener("click", () => {
  resumeImportInput.click();
});

document.querySelector("#retryImportFile").addEventListener("click", () => {
  resumeImportInput.click();
});

resumeImportInput.addEventListener("change", (event) => {
  processImportFile(event.target.files?.[0]);
});

document.querySelector("#closeImportDialog").addEventListener("click", () => importDialog.close());
document.querySelector("#cancelImport").addEventListener("click", () => importDialog.close());

rerunRecognitionButton.addEventListener("click", () => {
  try {
    const text = window.ResumeImporter.normalizeText(importExtractedText.value);
    const recognition = window.ResumeImporter.recognizeResumeText(text);
    showImportRecognition(currentImportFile, text, recognition);
    document.querySelector("#recognitionQuality").textContent = "已重新识别";
  } catch (error) {
    setImportStatus("无法重新识别", error?.message || "请检查简历文字后重试。", true);
  }
});

applyImportButton.addEventListener("click", () => {
  if (!currentImportRecognition) return;
  const mode = document.querySelector('input[name="importMode"]:checked')?.value || "replace";
  applyImportedResume(currentImportRecognition, mode);
});

document.querySelector("#avatarInput").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    state.avatar = reader.result;
    renderPreview();
    markSaving();
  });
  reader.readAsDataURL(file);
});

document.querySelector("#printButton").addEventListener("click", () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.print();
});

document.querySelector("#resetButton").addEventListener("click", () => {
  if (!window.confirm("确定清空全部内容吗？当前填写的数据会被覆盖。")) return;
  state = clone(originalResume);
  localStorage.removeItem(STORAGE_KEY);
  bindAndRenderAll();
  saveStatus.textContent = "内容已清空";
});

document.querySelectorAll(".nav-chip").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-chip").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#${button.dataset.target}`).scrollIntoView({ behavior: "smooth" });
  });
});

function setZoom(next) {
  zoom = Math.min(1.05, Math.max(0.6, next));
  document.querySelector("#resumePaper").style.transform = `scale(${zoom})`;
  document.querySelector("#zoomLabel").textContent = `${Math.round(zoom * 100)}%`;
}

document.querySelector("#zoomOut").addEventListener("click", () => setZoom(zoom - 0.05));
document.querySelector("#zoomIn").addEventListener("click", () => setZoom(zoom + 0.05));

function bindAndRenderAll() {
  const cleanForm = form.cloneNode(true);
  form.replaceWith(cleanForm);
  window.location.reload();
}

bindStaticFields();
bindCustomizationControls();
renderEditors();
renderSectionOrderEditor();
renderPreview();
setZoom(zoom);

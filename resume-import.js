(function initializeResumeImporter(globalScope) {
  const sectionAliases = {
    education: [
      "教育经历",
      "教育背景",
      "教育经验",
      "学历背景",
      "education",
      "academic background",
    ],
    work: [
      "工作经历",
      "工作经验",
      "职业经历",
      "实习经历",
      "employment",
      "work experience",
      "professional experience",
      "experience",
    ],
    projects: [
      "项目经历",
      "项目经验",
      "项目实践",
      "代表项目",
      "projects",
      "project experience",
    ],
    skills: [
      "专业技能",
      "个人技能",
      "核心技能",
      "技能专长",
      "技术栈",
      "个人优势",
      "自我评价",
      "skills",
      "technical skills",
      "core competencies",
      "profile",
    ],
  };

  const headingLookup = new Map(
    Object.entries(sectionAliases).flatMap(([key, aliases]) =>
      aliases.map((alias) => [normalizeHeading(alias), key]),
    ),
  );

  let mammothPromise = null;
  let pdfJsPromise = null;

  function normalizeHeading(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/^[\d一二三四五六七八九十]+[.、．)\s-]*/, "")
      .replace(/[：:|｜/·•\s_-]+/g, "")
      .trim();
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function cleanLine(value) {
    return String(value || "")
      .replace(/^[•●▪◦◆◇■□★☆✓✔▶►→·]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function loadScriptOnce(src, globalName) {
    if (globalScope[globalName]) return Promise.resolve(globalScope[globalName]);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-import-library="${globalName}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(globalScope[globalName]), { once: true });
        existing.addEventListener("error", () => reject(new Error("文档解析组件加载失败。")), {
          once: true,
        });
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.dataset.importLibrary = globalName;
      script.addEventListener("load", () => resolve(globalScope[globalName]), { once: true });
      script.addEventListener("error", () => reject(new Error("文档解析组件加载失败。")), {
        once: true,
      });
      document.head.appendChild(script);
    });
  }

  async function getMammoth() {
    mammothPromise ||= loadScriptOnce("./assets/vendor/mammoth.browser.min.js", "mammoth");
    return mammothPromise;
  }

  async function getPdfJs() {
    pdfJsPromise ||= import("./assets/vendor/pdf.min.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "./assets/vendor/pdf.worker.min.mjs";
      return pdfjs;
    });
    return pdfJsPromise;
  }

  function joinPdfItems(items) {
    const lines = [];
    let currentLine = "";
    let lastY = null;

    items.forEach((item) => {
      const text = item.str || "";
      if (!text) return;
      const y = item.transform?.[5];
      const startsNewLine = lastY !== null && Number.isFinite(y) && Math.abs(y - lastY) > 3;

      if (startsNewLine && currentLine.trim()) {
        lines.push(currentLine.trim());
        currentLine = "";
      }

      const needsSpace =
        currentLine &&
        /[A-Za-z0-9)]$/.test(currentLine) &&
        /^[A-Za-z0-9(]/.test(text) &&
        !currentLine.endsWith(" ");
      currentLine += `${needsSpace ? " " : ""}${text}`;

      if (item.hasEOL && currentLine.trim()) {
        lines.push(currentLine.trim());
        currentLine = "";
      }
      if (Number.isFinite(y)) lastY = y;
    });

    if (currentLine.trim()) lines.push(currentLine.trim());
    return lines.join("\n");
  }

  async function extractPdfText(file) {
    const pdfjs = await getPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({
      data,
      cMapUrl: "./assets/vendor/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "./assets/vendor/standard_fonts/",
    });
    const pdf = await loadingTask.promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(joinPdfItems(content.items));
    }

    return normalizeText(pages.join("\n\n"));
  }

  async function extractDocxText(file) {
    const mammoth = await getMammoth();
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return normalizeText(result.value);
  }

  async function extractText(file) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (file.type === "application/pdf" || extension === "pdf") {
      return extractPdfText(file);
    }
    if (
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      extension === "docx"
    ) {
      return extractDocxText(file);
    }
    if (["txt", "md"].includes(extension) || file.type.startsWith("text/")) {
      return normalizeText(await file.text());
    }
    throw new Error("暂不支持此格式。请选择 PDF、DOCX、TXT 或 Markdown 文件。");
  }

  function sectionKeyForLine(line) {
    const normalized = normalizeHeading(line);
    if (!normalized || normalized.length > 32) return null;
    if (headingLookup.has(normalized)) return headingLookup.get(normalized);

    for (const [alias, key] of headingLookup.entries()) {
      if (alias.length >= 4 && normalized === alias.replace(/经历|经验|背景/g, "")) return key;
    }
    return null;
  }

  function splitSections(text) {
    const sections = {
      basic: [],
      education: [],
      work: [],
      projects: [],
      skills: [],
    };
    const detectedTitles = {};
    let currentKey = "basic";

    normalizeText(text)
      .split("\n")
      .forEach((rawLine) => {
        const line = cleanLine(rawLine);
        if (!line) return;
        const sectionKey = sectionKeyForLine(line);
        if (sectionKey) {
          currentKey = sectionKey;
          detectedTitles[sectionKey] ||= line;
          return;
        }
        sections[currentKey].push(line);
      });

    return { sections, detectedTitles };
  }

  function firstMatch(text, pattern, group = 1) {
    const match = String(text || "").match(pattern);
    return match?.[group]?.trim() || "";
  }

  function labeledValue(lines, labels) {
    const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const pattern = new RegExp(`^(?:${labelPattern})\\s*[：:]\\s*(.+)$`, "i");
    for (const line of lines) {
      const match = line.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return "";
  }

  function normalizeBirthDate(value) {
    const match = String(value || "").match(/((?:19|20)\d{2})[./年-]\s*(\d{1,2})/);
    if (!match) return "";
    return `${match[1]}-${String(match[2]).padStart(2, "0")}`;
  }

  function normalizeWorkMonth(value) {
    const match = String(value || "").match(/((?:19|20)\d{2})(?:[./年-]\s*(\d{1,2}))?/);
    if (!match) return "";
    return `${match[1]}-${String(match[2] || 1).padStart(2, "0")}`;
  }

  function displayDate(value) {
    const match = String(value || "").match(/((?:19|20)\d{2})(?:[./年-]\s*(\d{1,2}))?/);
    if (!match) return String(value || "").trim();
    return match[2] ? `${match[1]}.${String(match[2]).padStart(2, "0")}` : match[1];
  }

  function dateRangeFromLine(line) {
    const dateToken = "(?:19|20)\\d{2}(?:[./年-]\\d{1,2})?";
    const match = String(line || "").match(
      new RegExp(`(${dateToken})\\s*(?:-|—|–|至|~|～)\\s*(至今|现在|目前|present|${dateToken})`, "i"),
    );
    return match ? { start: match[1], end: match[2] } : null;
  }

  function stripDateRange(line) {
    const range = dateRangeFromLine(line);
    if (!range) return line;
    return line
      .replace(range.start, "")
      .replace(range.end, "")
      .replace(/^[\s|｜·•,，、/—–~-]+|[\s|｜·•,，、/—–~-]+$/g, "")
      .trim();
  }

  function extractBasic(allLines, basicLines) {
    const searchable = [...basicLines, ...allLines];
    const joined = searchable.join("\n");
    const email = firstMatch(joined, /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/, 0);
    const phone = firstMatch(
      joined,
      /(?:\+?\d{1,4}[\s-]?)?(?:1[3-9]\d{9}|(?:\d[\s-]?){7,13}\d)/,
      0,
    ).replace(/\s+/g, " ");
    const labeledName = labeledValue(searchable, ["姓名", "名字", "name"]);
    const nameCandidate = basicLines.find((line) => {
      if (line.length < 2 || line.length > 28) return false;
      if (/简历|resume|curriculum|电话|手机|邮箱|email|求职|性别|出生/i.test(line)) return false;
      if (line.includes("@") || /\d{4,}/.test(line)) return false;
      return /^[\u3400-\u9fff·•\sA-Za-z.'-]+$/.test(line);
    });
    const birthSource =
      labeledValue(searchable, ["出生年月", "出生日期", "生日", "birth", "date of birth"]) ||
      firstMatch(joined, /(?:出生年月|出生日期|生日|birth)[^0-9]{0,8}((?:19|20)\d{2}[./年-]\d{1,2})/i) ||
      firstMatch(basicLines.join("\n"), /((?:19|20)\d{2}[./年-]\d{1,2})/);
    const genderSource =
      labeledValue(searchable, ["性别", "gender", "sex"]) ||
      firstMatch(joined, /(?:性别|gender|sex)\s*[：:]?\s*(男|女|male|female|其他)/i) ||
      firstMatch(basicLines.join("\n"), /(?:^|[\s|｜])(男|女)(?=$|[\s|｜])/m);
    const genderMap = { male: "男", female: "女", 男: "男", 女: "女", 其他: "其他" };

    return {
      name: labeledName || nameCandidate || "",
      birthDate: normalizeBirthDate(birthSource),
      gender: genderMap[genderSource.toLowerCase?.()] || genderMap[genderSource] || "",
      phone,
      email,
      jobTarget: labeledValue(searchable, [
        "求职意向",
        "期望职位",
        "目标职位",
        "应聘职位",
        "job objective",
        "objective",
      ]),
      salary: labeledValue(searchable, ["期望薪资", "薪资要求", "期望待遇", "salary"]),
    };
  }

  function splitEntryBlocks(lines, type) {
    const blocks = [];
    let current = [];
    let currentHasAnchor = false;
    const anchorPatterns = {
      education: /大学|学院|学校|中学|university|college|school/i,
      work: /公司|集团|事务所|银行|研究院|工作室|company|limited|ltd\b|inc\b|corp/i,
      projects: /^(?:项目名称|项目类型|project)\s*[：:]|项目$/i,
    };
    const anchorPattern = anchorPatterns[type];

    lines.forEach((line) => {
      const isAnchor = anchorPattern.test(line);
      const hasDate = Boolean(dateRangeFromLine(line));
      const shouldSplit =
        current.length > 0 &&
        ((isAnchor && currentHasAnchor) ||
          (hasDate && current.some((existingLine) => Boolean(dateRangeFromLine(existingLine)))));

      if (shouldSplit) {
        blocks.push(current);
        current = [];
        currentHasAnchor = false;
      }
      current.push(line);
      currentHasAnchor ||= isAnchor;
    });

    if (current.length) blocks.push(current);
    return blocks.filter((block) => block.some(Boolean));
  }

  function splitParts(line) {
    return String(line || "")
      .split(/\s{2,}|[|｜]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function removeUsedLines(lines, usedIndexes) {
    return lines
      .filter((_, index) => !usedIndexes.has(index))
      .map(cleanLine)
      .filter(Boolean)
      .join("\n");
  }

  function parseEducation(lines) {
    return splitEntryBlocks(lines, "education")
      .map((block) => {
        const used = new Set();
        let school = "";
        let degree = "";
        let major = "";
        let start = "";
        let end = "";

        block.forEach((line, index) => {
          const range = dateRangeFromLine(line);
          if (range && !start) {
            start = displayDate(range.start);
            end = /至今|现在|目前|present/i.test(range.end) ? "至今" : displayDate(range.end);
            if (!stripDateRange(line)) used.add(index);
          }

          if (!school && /大学|学院|学校|中学|university|college|school/i.test(line)) {
            const lineWithoutDate = stripDateRange(line);
            const degreeMatch = lineWithoutDate.match(
              /(博士|硕士|研究生|本科|学士|大专|专科|高中|ph\.?d|master|bachelor|mba)/i,
            );
            if (degreeMatch?.index > 0) {
              school = lineWithoutDate.slice(0, degreeMatch.index).trim();
              degree ||= degreeMatch[0];
              major ||= lineWithoutDate.slice(degreeMatch.index + degreeMatch[0].length).trim();
            } else {
              const schoolMatch = lineWithoutDate.match(
                /^(.+?(?:大学|学院|学校|中学|university|college|school))\s*(.*)$/i,
              );
              school = schoolMatch?.[1]?.trim() || lineWithoutDate;
              major ||= schoolMatch?.[2]?.trim() || "";
            }
            school = school.replace(/^(?:学校|院校)\s*[：:]\s*/, "");
            used.add(index);
          }

          if (!degree) {
            degree =
              firstMatch(line, /(博士|硕士|研究生|本科|学士|大专|专科|高中|ph\.?d|master|bachelor|mba)/i, 0) ||
              labeledValue([line], ["学历", "学位", "degree"]);
          }
          if (!major) {
            major = labeledValue([line], ["专业", "主修", "major", "programme", "program"]);
          }
        });

        if (!school && block.length) {
          school = stripDateRange(block[0]);
          used.add(0);
        }

        block.forEach((line, index) => {
          if (degree && cleanLine(line) === degree) used.add(index);
          if (major && /^(?:专业|主修|major|programme|program)\s*[：:]/i.test(line)) used.add(index);
        });

        return {
          school,
          degree,
          major,
          start,
          end,
          description: removeUsedLines(block, used),
        };
      })
      .filter((item) => Object.values(item).some(Boolean));
  }

  function parseWork(lines) {
    return splitEntryBlocks(lines, "work")
      .map((block) => {
        const used = new Set();
        let company = "";
        let role = "";
        let start = "";
        let end = "";

        block.forEach((line, index) => {
          const range = dateRangeFromLine(line);
          if (range && !start) {
            start = normalizeWorkMonth(range.start);
            end = /至今|现在|目前|present/i.test(range.end) ? "" : normalizeWorkMonth(range.end);
            if (!stripDateRange(line)) used.add(index);
          }

          if (!company && /公司|集团|事务所|银行|研究院|工作室|company|limited|ltd\b|inc\b|corp/i.test(line)) {
            const lineWithoutDate = stripDateRange(line);
            const companyMatch = lineWithoutDate.match(
              /^(.+?(?:有限责任公司|股份有限公司|有限公司|公司|集团|事务所|银行|研究院|工作室|company|limited|ltd\b|inc\b|corp\b))\s*(.*)$/i,
            );
            company =
              companyMatch?.[1]?.replace(/^(?:公司|单位)\s*[：:]\s*/, "").trim() ||
              lineWithoutDate.replace(/^(?:公司|单位)\s*[：:]\s*/, "");
            role ||= companyMatch?.[2]?.trim() || "";
            used.add(index);
          }

          role ||= labeledValue([line], ["职位", "岗位", "职务", "role", "position", "title"]);
        });

        if (!company && block.length) {
          company = stripDateRange(block[0]);
          used.add(0);
        }
        if (!role) {
          const roleIndex = block.findIndex(
            (line, index) =>
              !used.has(index) &&
              !dateRangeFromLine(line) &&
              line.length <= 30 &&
              !/[。；;]{1}/.test(line),
          );
          if (roleIndex >= 0) {
            role = cleanLine(block[roleIndex]).replace(/^(?:职位|岗位|职务)\s*[：:]\s*/, "");
            used.add(roleIndex);
          }
        }

        block.forEach((line, index) => {
          if (/^(?:职位|岗位|职务|role|position|title)\s*[：:]/i.test(line)) used.add(index);
        });

        return {
          company,
          role,
          start,
          end,
          description: removeUsedLines(block, used),
        };
      })
      .filter((item) => Object.values(item).some(Boolean));
  }

  function parseProjects(lines) {
    return splitEntryBlocks(lines, "projects")
      .map((block) => {
        const used = new Set();
        let name = "";
        let subtitle = "";

        block.forEach((line, index) => {
          name ||= labeledValue([line], ["项目类型", "项目类别", "类型", "project type"]);
          subtitle ||= labeledValue([line], ["项目名称", "名称", "project name"]);
          if (/^(?:项目类型|项目类别|类型|项目名称|名称|project type|project name)\s*[：:]/i.test(line)) {
            used.add(index);
          }
        });

        if (!name && subtitle) {
          name = "项目";
        }
        if (!name && !subtitle && block[0]) {
          const parts = splitParts(stripDateRange(block[0]));
          name = parts.length > 1 ? parts[0] : "项目";
          subtitle = parts.length > 1 ? parts[1] : parts[0] || "";
          used.add(0);
        }
        if (!subtitle) {
          const subtitleIndex = block.findIndex(
            (line, index) => !used.has(index) && !dateRangeFromLine(line) && line.length <= 42,
          );
          if (subtitleIndex >= 0) {
            subtitle = cleanLine(block[subtitleIndex]);
            used.add(subtitleIndex);
          }
        }

        return {
          name,
          subtitle,
          description: removeUsedLines(block, used),
        };
      })
      .filter((item) => Object.values(item).some(Boolean));
  }

  function countBasicFields(basic) {
    return Object.values(basic).filter(Boolean).length;
  }

  function recognizeResumeText(text) {
    const normalized = normalizeText(text);
    if (normalized.length < 10) throw new Error("没有读取到足够文字，可能是扫描版 PDF。请使用可复制文字的 PDF、DOCX 或 TXT。");

    const allLines = normalized.split("\n").map(cleanLine).filter(Boolean);
    const { sections, detectedTitles } = splitSections(normalized);
    const basic = extractBasic(allLines, sections.basic);
    const education = parseEducation(sections.education);
    const work = parseWork(sections.work);
    const projects = parseProjects(sections.projects);
    const skills = sections.skills.map(cleanLine).filter(Boolean).join("\n");

    return {
      basic,
      education,
      work,
      projects,
      skills,
      detectedTitles,
      summary: {
        basicFields: countBasicFields(basic),
        educationEntries: education.length,
        workEntries: work.length,
        projectEntries: projects.length,
        skillLines: skills ? skills.split("\n").length : 0,
      },
    };
  }

  globalScope.ResumeImporter = {
    extractText,
    normalizeText,
    recognizeResumeText,
  };
})(typeof window === "undefined" ? globalThis : window);

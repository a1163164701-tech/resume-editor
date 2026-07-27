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
      .normalize("NFKC")
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[┃︱]/g, "｜")
      .replace(/⻛/g, "风")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function cleanLine(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/⻛/g, "风")
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

  function pdfItemMetrics(item) {
    const transform = item.transform || [];
    const fontSize = Math.max(
      Math.abs(Number(transform[0])) || 0,
      Math.abs(Number(transform[3])) || 0,
      Math.abs(Number(item.height)) || 0,
      8,
    );
    return {
      item,
      text: cleanLine(item.str || ""),
      x: Number(transform[4]) || 0,
      y: Number(transform[5]) || 0,
      width: Math.max(Number(item.width) || 0, 0),
      fontSize,
    };
  }

  function separatorForPdfItems(previous, current) {
    const gap = current.x - (previous.x + previous.width);
    const referenceSize = Math.max(8, Math.min(previous.fontSize, current.fontSize));
    if (gap >= Math.max(13, referenceSize * 1.55)) return " | ";

    const previousText = previous.text;
    const currentText = current.text;
    const crossesLatinBoundary =
      (/[A-Za-z0-9)]$/.test(previousText) && /^[A-Za-z0-9(\u3400-\u9fff]/.test(currentText)) ||
      (/[\u3400-\u9fff]$/.test(previousText) && /^[A-Za-z0-9(]/.test(currentText));
    if (crossesLatinBoundary && gap > referenceSize * 0.08) {
      return " ";
    }
    return "";
  }

  function joinPdfItems(items) {
    const positioned = items.map(pdfItemMetrics).filter((entry) => entry.text);
    const lines = [];

    positioned
      .sort((left, right) => right.y - left.y || left.x - right.x)
      .forEach((entry) => {
        const tolerance = Math.max(2.2, Math.min(4, entry.fontSize * 0.36));
        let line = lines.find((candidate) => Math.abs(candidate.y - entry.y) <= tolerance);
        if (!line) {
          line = { y: entry.y, items: [] };
          lines.push(line);
        }
        line.items.push(entry);
        line.y = (line.y * (line.items.length - 1) + entry.y) / line.items.length;
      });

    return lines
      .sort((left, right) => right.y - left.y)
      .map((line) => {
        const sortedItems = line.items.sort((left, right) => left.x - right.x);
        return sortedItems
          .map((entry, index) => {
            if (!index) return entry.text;
            return `${separatorForPdfItems(sortedItems[index - 1], entry)}${entry.text}`;
          })
          .join("")
          .replace(/\s*\|\s*(?:\|\s*)+/g, " | ")
          .replace(/\s{2,}/g, " ")
          .trim();
      })
      .filter(Boolean)
      .join("\n");
  }

  function pageObject(page, objectId) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value || null);
      };
      try {
        const immediate = page.objs.get(objectId, finish);
        if (immediate) finish(immediate);
      } catch {
        finish(null);
      }
      globalScope.setTimeout(() => finish(null), 1200);
    });
  }

  function imageObjectToDataUrl(image) {
    if (!image?.width || !image?.height) return "";
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: false });
    if (!context) return "";

    if (image.bitmap) {
      context.drawImage(image.bitmap, 0, 0, image.width, image.height);
      return canvas.toDataURL("image/jpeg", 0.9);
    }

    const source = image.data;
    if (!source) return "";
    const pixelCount = image.width * image.height;
    const rgba = new Uint8ClampedArray(pixelCount * 4);
    if (source.length === pixelCount * 4) {
      rgba.set(source);
    } else if (source.length === pixelCount * 3) {
      for (let sourceIndex = 0, targetIndex = 0; sourceIndex < source.length; sourceIndex += 3) {
        rgba[targetIndex++] = source[sourceIndex];
        rgba[targetIndex++] = source[sourceIndex + 1];
        rgba[targetIndex++] = source[sourceIndex + 2];
        rgba[targetIndex++] = 255;
      }
    } else if (source.length === pixelCount) {
      for (let sourceIndex = 0, targetIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
        const value = source[sourceIndex];
        rgba[targetIndex++] = value;
        rgba[targetIndex++] = value;
        rgba[targetIndex++] = value;
        rgba[targetIndex++] = 255;
      }
    } else {
      return "";
    }

    context.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  async function extractPdfAvatar(page, pdfjs) {
    try {
      const operatorList = await page.getOperatorList();
      const candidates = [];
      for (let index = 0; index < operatorList.fnArray.length; index += 1) {
        const operation = operatorList.fnArray[index];
        let image = null;
        if (operation === pdfjs.OPS.paintImageXObject) {
          image = await pageObject(page, operatorList.argsArray[index]?.[0]);
        } else if (operation === pdfjs.OPS.paintInlineImageXObject) {
          image = operatorList.argsArray[index]?.[0] || null;
        }
        if (!image?.width || !image?.height) continue;

        const shortSide = Math.min(image.width, image.height);
        const longSide = Math.max(image.width, image.height);
        const ratio = longSide / shortSide;
        if (shortSide < 64 || ratio > 1.8) continue;
        const area = image.width * image.height;
        const sizeFit = area <= 1_200_000 ? 1 : 1_200_000 / area;
        candidates.push({
          image,
          score: (1 / ratio) * sizeFit * Math.min(shortSide, 600),
        });
      }

      const best = candidates.sort((left, right) => right.score - left.score)[0];
      return best ? imageObjectToDataUrl(best.image) : "";
    } catch {
      return "";
    }
  }

  async function extractPdfResume(file) {
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
    let avatar = "";

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(joinPdfItems(content.items));
      if (pageNumber === 1) avatar = await extractPdfAvatar(page, pdfjs);
    }

    return {
      text: normalizeText(pages.join("\n\n")),
      avatar,
    };
  }

  async function extractPdfText(file) {
    return (await extractPdfResume(file)).text;
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

  async function extractResume(file) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (file.type === "application/pdf" || extension === "pdf") {
      return extractPdfResume(file);
    }
    return {
      text: await extractText(file),
      avatar: "",
    };
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
      const hasDate = Boolean(dateRangeFromLine(line));
      const looksLikeShortHeader =
        line.length <= 100 && !/[。；;，,：:]/.test(line) && !/^[•●▪◦◆◇■□★☆✓✔▶►→·]/.test(line);
      const isAnchor =
        anchorPattern.test(line) &&
        (type === "projects" ||
          hasDate ||
          /^(?:学校|院校|公司|单位)\s*[：:]/i.test(line) ||
          looksLikeShortHeader);
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
      .split(/\s{2,}|[|｜]|\u3000{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function joinWrappedText(previous, current) {
    const needsSpace =
      (/[A-Za-z0-9)]$/.test(previous) && /^[A-Za-z0-9(\u3400-\u9fff]/.test(current)) ||
      (/[\u3400-\u9fff]$/.test(previous) && /^[A-Za-z0-9(]/.test(current));
    return `${previous}${needsSpace ? " " : ""}${current}`;
  }

  function mergeDescriptionLines(lines) {
    const merged = [];
    lines.map(cleanLine).filter(Boolean).forEach((line) => {
      const startsLabeledItem = /^[^：:]{1,40}[：:]/.test(line);
      const startsBullet = /^[•●▪◦◆◇■□★☆✓✔▶►→·]/.test(line);
      if (!merged.length || startsLabeledItem || startsBullet) {
        merged.push(line);
      } else {
        merged[merged.length - 1] = joinWrappedText(merged[merged.length - 1], line);
      }
    });
    return merged;
  }

  function removeUsedLines(lines, usedIndexes) {
    const remaining = lines
      .filter((_, index) => !usedIndexes.has(index))
      .map(cleanLine)
      .filter(Boolean);
    return mergeDescriptionLines(remaining).join("\n");
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
            const columns = splitParts(lineWithoutDate);
            const schoolColumnIndex = columns.findIndex((part) =>
              /大学|学院|学校|中学|university|college|school/i.test(part),
            );
            const schoolColumn =
              schoolColumnIndex >= 0 ? columns.slice(0, schoolColumnIndex + 1).join(" | ") : "";
            const detailColumns =
              schoolColumnIndex >= 0 ? columns.slice(schoolColumnIndex + 1) : [];
            const degreeMatch = lineWithoutDate.match(
              /(博士|硕士|研究生|本科|学士|大专|专科|高中|ph\.?d|master|bachelor|mba)/i,
            );
            if (schoolColumn && columns.length > 1) {
              school = schoolColumn;
              degree ||= firstMatch(
                detailColumns.join(" "),
                /(博士|硕士|研究生|本科|学士|大专|专科|高中|ph\.?d|master|bachelor|mba)/i,
                0,
              );
              major ||= detailColumns
                .filter((part) => !degree || !part.toLowerCase().includes(degree.toLowerCase()))
                .join(" ")
                .trim();
            } else if (degreeMatch?.index > 0) {
              school = lineWithoutDate.slice(0, degreeMatch.index).replace(/[|｜\s]+$/, "").trim();
              degree ||= degreeMatch[0];
              major ||= lineWithoutDate
                .slice(degreeMatch.index + degreeMatch[0].length)
                .replace(/^[|｜\s]+/, "")
                .trim();
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
            const columns = splitParts(lineWithoutDate);
            const companyColumnIndex = columns.findIndex((part) =>
              /公司|集团|事务所|银行|研究院|工作室|company|limited|ltd\b|inc\b|corp/i.test(part),
            );
            const companyMatch = lineWithoutDate.match(
              /^(.+?(?:有限责任公司|股份有限公司|有限公司|公司|集团|事务所|银行|研究院|工作室|company|limited|ltd\b|inc\b|corp\b))\s*(.*)$/i,
            );
            if (companyColumnIndex >= 0 && columns.length > 1) {
              company = columns
                .slice(0, companyColumnIndex + 1)
                .join(" | ")
                .replace(/^(?:公司|单位)\s*[：:]\s*/, "")
                .trim();
              role ||= columns.slice(companyColumnIndex + 1).join(" ").trim();
            } else {
              company =
                companyMatch?.[1]?.replace(/^(?:公司|单位)\s*[：:]\s*/, "").trim() ||
                lineWithoutDate.replace(/^(?:公司|单位)\s*[：:]\s*/, "");
              role ||= companyMatch?.[2]?.replace(/^[|｜\s]+/, "").trim() || "";
            }
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
        let start = "";
        let end = "";

        block.forEach((line, index) => {
          const range = dateRangeFromLine(line);
          if (range && !start) {
            start = normalizeWorkMonth(range.start);
            end = /至今|现在|目前|present/i.test(range.end) ? "" : normalizeWorkMonth(range.end);
            if (!stripDateRange(line)) used.add(index);
          }
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
          start,
          end,
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
    const skills = mergeDescriptionLines(sections.skills).join("\n");

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
    extractResume,
    extractText,
    normalizeText,
    recognizeResumeText,
  };
})(typeof window === "undefined" ? globalThis : window);

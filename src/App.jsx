import React, { useState } from "react";
import * as XLSX from "xlsx";
import "./App.css";

function App() {
  const [error, setError] = useState("");
  const [jsonOutput, setJsonOutput] = useState("");

  const [fileName, setFileName] = useState("");
  const [aoaBySheet, setAoaBySheet] = useState({});
  const [sheets, setSheets] = useState([]); // {name, selected}

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  // image config
  const [baseUrl, setBaseUrl] = useState("");
  const [imagePrefix, setImagePrefix] = useState(""); // optional "{prefix}" segment
  const [imageLang, setImageLang] = useState("zh");   // default language

  const normalizeHeader = (h) =>
    String(h || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");

  // ========== RESET ==========
  const resetAll = () => {
    setFileName("");
    setError("");
    setJsonOutput("");
    setAoaBySheet({});
    setSheets([]);
    // keep baseUrl / image config so user doesn’t have to retype
  };

  // ========== FILE UPLOAD ==========
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError("");
    setJsonOutput("");
    setAoaBySheet({});
    setSheets([]);

    setIsLoading(true);
    setLoadingMessage("Reading workbook & discovering tabs...");

    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const data = evt.target.result;
        const wb = XLSX.read(data, { type: "binary" });

        const bySheet = {};
        const newSheets = [];

        wb.SheetNames.forEach((sheetName) => {
          const sheet = wb.Sheets[sheetName];
          if (!sheet) return;

          const aoa = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            raw: true,
          });

          if (!aoa || aoa.length === 0) return;

          bySheet[sheetName] = aoa;
          newSheets.push({
            name: sheetName,
            selected: true, // default: all selected
          });
        });

        if (!newSheets.length) {
          setError("No usable sheets found in this file.");
        } else {
          setAoaBySheet(bySheet);
          setSheets(newSheets);
        }
      } catch (err) {
        console.error(err);
        setError("Failed to read Excel file. Check console for details.");
      } finally {
        setIsLoading(false);
        setLoadingMessage("");
      }
    };

    reader.onerror = () => {
      setIsLoading(false);
      setLoadingMessage("");
      setError("Error reading file.");
    };

    reader.readAsBinaryString(file);
  };

  // ========== SHEET SELECTION ==========
  const toggleSheetSelection = (name) => {
    setSheets((prev) =>
      prev.map((s) =>
        s.name === name ? { ...s, selected: !s.selected } : s
      )
    );
  };

  const selectAll = () => {
    setSheets((prev) => prev.map((s) => ({ ...s, selected: true })));
  };

  const clearAll = () => {
    setSheets((prev) => prev.map((s) => ({ ...s, selected: false })));
  };

  // ========== CONVERSION CORE ==========
  const buildImageUrl = (vendorCode, gameCode) => {
    const base = baseUrl.trim().replace(/\/+$/, "");
    if (!base) return null;

    const vendorSegment = (vendorCode || "").toLowerCase();
    const prefixSegment = imagePrefix.trim();
    const langSegment = imageLang.trim() || "en";

    let url = `${base}/images/games/${vendorSegment}`;
    if (prefixSegment) url += `/${prefixSegment}`;
    url += `/games/${langSegment}/${gameCode}.png`;
    return url;
  };

  const convertSheet = (sheetName, aoa) => {
    let vendorCode = null;
    let walletCode = null;

    // Find Vendor Code row
    for (const row of aoa) {
      for (let j = 0; j < row.length; j++) {
        const cell = row[j];
        if (!cell) continue;
        const text = String(cell).trim();
        const norm = normalizeHeader(text).replace(/[:：]/g, "");
        const readNextNonEmpty = () => {
          for (let k = j + 1; k < row.length; k++) {
            if (
              row[k] !== undefined &&
              row[k] !== null &&
              row[k] !== ""
            ) {
              return String(row[k]).trim();
            }
          }
          return null;
        };

        if (!walletCode && norm.startsWith("walletcode")) {
          walletCode = readNextNonEmpty();
        }

        if (!vendorCode && norm.startsWith("vendorcode")) {
          vendorCode = readNextNonEmpty();
        }
      }
    }

    // Find header row with Game Code
    let headerRowIndex = -1;
    for (let i = 0; i < aoa.length; i++) {
      const row = aoa[i];
      const hasGameCode = row.some(
        (cell) => normalizeHeader(cell) === "gamecode"
      );
      if (hasGameCode) {
        headerRowIndex = i;
        break;
      }
    }
    if (headerRowIndex === -1) {
      console.warn(`No "Game Code" header found in sheet: ${sheetName}`);
      return null;
    }

    const headers = aoa[headerRowIndex];
    const rows = aoa.slice(headerRowIndex + 1);

    const headerIndex = {};
    headers.forEach((h, idx) => {
      const key = normalizeHeader(h);
      if (key) headerIndex[key] = idx;
    });

    const getValue = (row, key) => {
      const idx = headerIndex[key];
      return idx !== undefined ? row[idx] ?? null : null;
    };

    const games = [];

    rows.forEach((row) => {
      const nonEmpty = row.some(
        (c) => c !== undefined && c !== null && c !== ""
      );
      if (!nonEmpty) return;

      const gameCode = getValue(row, "gamecode");
      if (!gameCode) return;

      const rankVal = getValue(row, "rank");
      const rankNum =
        typeof rankVal === "number"
          ? rankVal
          : rankVal
            ? Number(rankVal)
            : null;

      const gameType = getValue(row, "gametype");
      const category = gameType ? String(gameType).toLowerCase() : null;

      const nameCN = getValue(row, "cngamename");
      const nameEN = getValue(row, "gamename");

      const vCode = vendorCode || sheetName.trim();
      const codeStr = String(gameCode);

      games.push({
        vendorCode: vCode,
        code: codeStr,
        name: nameCN || nameEN || null,
        image: buildImageUrl(vCode, codeStr),
        category,
        type: null,
        typeName: null,
        platform: getValue(row, "platform"),
        freeGameAvailable: null,
        isPaidGame: false,
        imageUrl: null,
        isJackpotGame: false,
        isHotGame: false,
        turnover: 0.0,
        sort: rankNum ?? games.length + 1,
        rtp: getValue(row, "rtp"),
        updateDate: getValue(row, "updatedate"),
      });
    });

    if (!games.length) return null;

    return {
      vendorCode: vendorCode || sheetName.trim(),
      walletCode: walletCode || null,
      games,
    };
  };

  const convertSelectedTabs = () => {
    if (!baseUrl.trim()) {
      setError("Please enter Base URL in Step 1 before converting.");
      return;
    }

    if (!sheets.length) {
      setError("Please upload an Excel file first.");
      return;
    }

    const selected = sheets.filter((s) => s.selected);
    if (!selected.length) {
      setError("Please select at least one tab to convert.");
      return;
    }

    setError("");
    setIsLoading(true);
    setLoadingMessage("Converting selected tabs to JSON...");

    try {
      const vendorList = [];
      const exportDate = new Date().toISOString();

      selected.forEach(({ name }) => {
        const aoa = aoaBySheet[name];
        if (!aoa) return;
        const vendorObj = convertSheet(name, aoa);
        if (!vendorObj) return;

        vendorList.push({
          vendorCode: vendorObj.vendorCode,
          walletCode: vendorObj.walletCode,
          exportDate,
          totalGames: vendorObj.games.length,
          games: vendorObj.games,
        });
      });

      setJsonOutput(JSON.stringify({ vendors: vendorList }, null, 2));
    } catch (err) {
      console.error(err);
      setError("Conversion failed. See console for details.");
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  // ========== UTIL ==========
  const downloadJson = () => {
    if (!jsonOutput) return;
    const blob = new Blob([jsonOutput], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vendors-games.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = () => {
    if (!jsonOutput) return;
    navigator.clipboard.writeText(jsonOutput).catch(console.error);
  };

  const totalTabs = sheets.length;
  const selectedTabs = sheets.filter((s) => s.selected).length;

  return (
    <div className="app-root">
      {/* Loading overlay */}
      {isLoading && (
        <div className="loading-overlay">
          <div className="loading-card">
            <div className="spinner" />
            <div className="loading-text">
              {loadingMessage || "Working..."}
            </div>
          </div>
        </div>
      )}

      <header className="app-header">
        <h1>Excel → Vendor Games JSON</h1>
        <p className="subtitle">
          Configure image URL, upload your game list Excel, choose vendor tabs,
          and export editable JSON.
        </p>

        <div className="steps">
          <div className="step active">
            <span className="step-number">1</span> Configure & Upload
          </div>
          <div className={`step ${sheets.length ? "active" : ""}`}>
            <span className="step-number">2</span> Select Tabs
          </div>
          <div className={`step ${jsonOutput ? "active" : ""}`}>
            <span className="step-number">3</span> View / Edit JSON
          </div>
        </div>
      </header>

      <main className="app-main">
        {/* LEFT COLUMN */}
        <section className="left-column">
          {/* Config + upload card */}
          <div className="card">
            <div className="card-header">
              <h2>1. Base URL & File</h2>
            </div>
            <div className="card-body">
              <div className="field-grid">
                <div className="field">
                  <label>
                    Base URL <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="https://stg-memberapi.example.com"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    disabled={isLoading}
                  />
                  <small>
                    Used as{" "}
                    <code>
                      {`{baseUrl}/images/games/{vendor}/{prefix}/games/{lang}/{code}.png`}
                    </code>
                  </small>
                </div>
                <div className="field">
                  <label>Image prefix (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. goldf, obslot_gf"
                    value={imagePrefix}
                    onChange={(e) => setImagePrefix(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
                <div className="field">
                  <label>Language code</label>
                  <input
                    type="text"
                    placeholder="zh"
                    value={imageLang}
                    onChange={(e) => setImageLang(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="upload-row">
                <label className="file-input-label">
                  <span className="file-button">Choose file</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileChange}
                    disabled={isLoading}
                  />
                </label>

                <div className="file-info-row">
                  {fileName ? (
                    <>
                      <div className="file-info">
                        <span className="file-name">{fileName}</span>
                        {totalTabs > 0 && (
                          <span className="file-meta">
                            {totalTabs} tab{totalTabs > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="remove-file-button"
                        onClick={resetAll}
                        disabled={isLoading}
                      >
                        Remove File
                      </button>
                    </>
                  ) : (
                    <span className="file-placeholder">
                      No file selected yet
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Tab selection card */}
          {sheets.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h2>2. Select Tabs to Convert</h2>
                <div className="tab-summary">
                  <span>
                    Selected {selectedTabs} / {totalTabs}
                  </span>
                  <div className="tab-actions">
                    <button
                      type="button"
                      onClick={selectAll}
                      className="link-button"
                      disabled={isLoading}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={clearAll}
                      className="link-button"
                      disabled={isLoading}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
              <div className="card-body">
                <div className="sheet-grid">
                  {sheets.map((sheet) => (
                    <button
                      key={sheet.name}
                      type="button"
                      className={
                        "sheet-chip" +
                        (sheet.selected ? " sheet-chip--selected" : "")
                      }
                      onClick={() => toggleSheetSelection(sheet.name)}
                      disabled={isLoading}
                    >
                      <span className="sheet-checkbox">
                        {sheet.selected ? "✓" : ""}
                      </span>
                      <span className="sheet-name">{sheet.name}</span>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={convertSelectedTabs}
                  className="primary-button full-width"
                  disabled={isLoading || !selectedTabs}
                >
                  Convert Selected Tabs
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="error-banner">
              <strong>Error:</strong> {error}
            </div>
          )}
        </section>

        {/* RIGHT COLUMN */}
        <section className="right-column">
          <div className="card">
            <div className="card-header right-header">
              <h2>3. JSON Preview / Edit</h2>
              <div className="right-header-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={copyToClipboard}
                  disabled={!jsonOutput}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={downloadJson}
                  disabled={!jsonOutput}
                >
                  Download
                </button>
              </div>
            </div>
            <div className="card-body">
              {jsonOutput ? (
                <textarea
                  className="json-textarea"
                  value={jsonOutput}
                  onChange={(e) => setJsonOutput(e.target.value)}
                />
              ) : (
                <div className="json-placeholder">
                  JSON will appear here after you convert selected tabs. You
                  can edit it directly before copying or downloading.
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;

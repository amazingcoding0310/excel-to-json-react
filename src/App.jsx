import React, { useState } from "react";
import * as XLSX from "xlsx";
import "./App.css";

function App() {
  const [error, setError] = useState("");
  const [jsonOutput, setJsonOutput] = useState("");

  const [fileName, setFileName] = useState("");
  const [aoaBySheet, setAoaBySheet] = useState({});
  const [sheets, setSheets] = useState([]); // { name, selected, vendorCode, walletCode }

  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  // Global image configuration
  const [baseUrl, setBaseUrl] = useState("");
  const [imageLang, setImageLang] = useState("zh");

  // Per-vendor configs: { [vendorCode]: { prefix: string } }
  const [vendorConfigs, setVendorConfigs] = useState({});

  const normalizeHeader = (h) =>
    String(h || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");

  // ----- Helpers -----

  const extractVendorAndWallet = (aoa) => {
    let vendorCode = null;
    let walletCode = null;

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

    return { vendorCode, walletCode };
  };

  const buildImageUrl = (vendorCode, gameCode) => {
    const base = baseUrl.trim().replace(/\/+$/, "");
    if (!base) return null;

    const v = (vendorCode || "").trim();
    if (!v) return null;

    const vendorSegment = v.toLowerCase();
    const prefix =
      vendorConfigs[v]?.prefix?.trim() || vendorSegment;
    const langSegment = imageLang.trim() || "en";

    return `${base}/images/games/${vendorSegment}/${prefix}/games/${langSegment}/${gameCode}.png`;
  };

  // ----- Reset (Remove file) -----

  const resetAll = () => {
    setFileName("");
    setError("");
    setJsonOutput("");
    setAoaBySheet({});
    setSheets([]);
    setVendorConfigs({});
    // Keep baseUrl & imageLang so user can reuse them
  };

  // ----- Step 1: Upload Excel -----

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError("");
    setJsonOutput("");
    setAoaBySheet({});
    setSheets([]);
    setVendorConfigs({});

    setIsLoading(true);
    setLoadingMessage("Reading workbook & discovering tabs...");

    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const data = evt.target.result;
        const wb = XLSX.read(data, { type: "binary" });

        const bySheet = {};
        const newSheets = [];
        const newVendorConfigs = {};

        wb.SheetNames.forEach((sheetName) => {
          const sheet = wb.Sheets[sheetName];
          if (!sheet) return;

          const aoa = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            raw: true,
          });

          if (!aoa || aoa.length === 0) return;

          bySheet[sheetName] = aoa;

          const meta = extractVendorAndWallet(aoa);
          const vendorKey = (meta.vendorCode || sheetName).trim();

          newSheets.push({
            name: sheetName,
            selected: true,
            vendorCode: meta.vendorCode || sheetName,
            walletCode: meta.walletCode || null,
          });

          if (!newVendorConfigs[vendorKey]) {
            newVendorConfigs[vendorKey] = {
              prefix: vendorKey.toLowerCase(),
            };
          }
        });

        if (!newSheets.length) {
          setError("No usable sheets found in this file.");
        } else {
          setAoaBySheet(bySheet);
          setSheets(newSheets);
          setVendorConfigs(newVendorConfigs);
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

  // ----- Step 2: Select tabs -----

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

  const totalTabs = sheets.length;
  const selectedTabs = sheets.filter((s) => s.selected).length;

  const selectedVendorKeys = Array.from(
    new Set(
      sheets
        .filter((s) => s.selected)
        .map((s) => (s.vendorCode || s.name).trim())
    )
  );

  // ----- Sheet -> games (core conversion) -----

  const convertSheet = (sheetName, aoa) => {
    let walletCode = null;
    let vendorCode = null;

    // 1) Vendor & wallet
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

    // 2) Header row with Game Code
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
    const vCode = (vendorCode || sheetName).trim();

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
      vendorCode: vCode,
      walletCode: walletCode || null,
      games,
    };
  };

  // ----- Step 3: Convert with selected tabs + baseUrl + vendor prefixes -----

  const convertSelectedTabs = () => {
    if (!sheets.length) {
      setError("Please upload an Excel file first.");
      return;
    }

    const selected = sheets.filter((s) => s.selected);
    if (!selected.length) {
      setError("Please select at least one tab to convert.");
      return;
    }

    if (!baseUrl.trim()) {
      setError("Please enter Base URL in Step 3 before converting.");
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

  // ----- JSON utils -----

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

  // ----- JSX -----

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
          Upload your Excel, choose tabs, configure per-vendor image prefix,
          then preview & edit the JSON.
        </p>

        <div className="steps">
          <div className="step active">
            <span className="step-number">1</span> Upload Excel
          </div>
          <div className={`step ${sheets.length ? "active" : ""}`}>
            <span className="step-number">2</span> Select Tabs
          </div>
          <div className={`step ${selectedTabs ? "active" : ""}`}>
            <span className="step-number">3</span> Configure Image URL
          </div>
          <div className={`step ${jsonOutput ? "active" : ""}`}>
            <span className="step-number">4</span> Preview / Edit JSON
          </div>
        </div>
      </header>

      <main className="app-main">
        {/* Left side: Steps 1–3 */}
        <section className="left-column">
          {/* Step 1 */}
          <div className="card">
            <div className="card-header">
              <h2>1. Upload Excel File</h2>
            </div>
            <div className="card-body">
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

          {/* Step 2 */}
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
                      <span className="sheet-name">
                        {sheet.name}
                        {sheet.vendorCode &&
                          sheet.vendorCode !== sheet.name &&
                          ` (${sheet.vendorCode})`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3 */}
          {sheets.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h2>3. Configure Image URL</h2>
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
                      Pattern:{" "}
                      <code>
                        {`{baseUrl}/images/games/{vendor}/{prefix}/games/{lang}/{code}.png`}
                      </code>
                    </small>
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

                <h3 className="mt-20">Vendor prefixes</h3>
                {selectedVendorKeys.length ? (
                  <div className="vendor-prefix-table">
                    {selectedVendorKeys.map((vendor) => {
                      const cfg =
                        vendorConfigs[vendor] || {
                          prefix: vendor.toLowerCase(),
                        };
                      return (
                        <div
                          key={vendor}
                          className="vendor-prefix-row"
                        >
                          <div className="vendor-label">
                            {vendor}
                          </div>
                          <input
                            className="vendor-prefix-input"
                            value={cfg.prefix}
                            onChange={(e) =>
                              setVendorConfigs((prev) => ({
                                ...prev,
                                [vendor]: {
                                  prefix: e.target.value,
                                },
                              }))
                            }
                            disabled={isLoading}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="json-placeholder">
                    Select at least one tab to see vendor prefixes.
                  </div>
                )}

                <button
                  type="button"
                  onClick={convertSelectedTabs}
                  className="primary-button full-width mt-20"
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

        {/* Right side: Step 4 – JSON editor */}
        <section className="right-column">
          <div className="card">
            <div className="card-header right-header">
              <h2>4. JSON Preview / Edit</h2>
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
                  JSON will appear here after you convert selected tabs.
                  You can edit it directly before copying or downloading.
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

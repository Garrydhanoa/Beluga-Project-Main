const fs = require('fs');
const path = require('path');

const DIVISIONS = ['aa', 'aaa', 'majors'];

function columnLetter(index) {
  let letter = '';
  let temp = index;
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

function summarizeSheet(sheet) {
  const formulasByColumn = {};
  const formulasByA1 = {};

  (sheet.formulas || []).forEach((item) => {
    const colLetter = columnLetter(item.col);
    if (!formulasByColumn[colLetter]) {
      formulasByColumn[colLetter] = { count: 0, examples: new Map() };
    }
    formulasByColumn[colLetter].count += 1;

    if (!formulasByColumn[colLetter].examples.has(item.formula)) {
      formulasByColumn[colLetter].examples.set(item.formula, 0);
    }
    formulasByColumn[colLetter].examples.set(
      item.formula,
      formulasByColumn[colLetter].examples.get(item.formula) + 1
    );

    const a1 = item.a1 || `${colLetter}${item.row}`;
    formulasByA1[a1] = item.formula;
  });

  const columnSummary = Object.entries(formulasByColumn).map(([col, data]) => {
    const examples = Array.from(data.examples.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([formula, count]) => ({ formula, count }));

    return { col, count: data.count, examples };
  });

  columnSummary.sort((a, b) => a.col.localeCompare(b.col));

  return {
    title: sheet.title,
    usedRange: sheet.usedRange,
    grid: sheet.grid,
    headerPreview: sheet.headers || [],
    formulaCount: (sheet.formulas || []).length,
    columns: columnSummary
  };
}

function summarizeDivision(division) {
  const filePath = path.join(__dirname, '..', 'sheet-dumps', `${division}-sheets.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const sheets = (data.sheets || []).map(summarizeSheet);

  return {
    division,
    spreadsheetId: data.spreadsheetId,
    title: data.title,
    fetchedAt: data.fetchedAt,
    sheets
  };
}

function main() {
  const summary = {
    generatedAt: new Date().toISOString(),
    divisions: []
  };

  for (const division of DIVISIONS) {
    const divisionSummary = summarizeDivision(division);
    if (divisionSummary) {
      summary.divisions.push(divisionSummary);
    }
  }

  const outputPath = path.join(__dirname, '..', 'sheet-dumps', 'summary.json');
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`Saved summary: ${outputPath}`);
}

main();

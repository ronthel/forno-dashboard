import jsPDF from 'jspdf';

// 1. Exportação para arquivo CSV (compatível com Excel)
export const exportToCSV = (fieldName, data) => {
  if (!data || data.length === 0) return;

  let csvContent = "data:text/csv;charset=utf-8,Data e Hora;Valor\n";
  data.forEach((row) => {
    csvContent += `${row.time};${row.value}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `relatorio_${fieldName}_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// 2. Exportação para Relatório PDF
export const exportToPDF = (fieldName, data, minLimit, maxLimit) => {
  if (!data || data.length === 0) return;

  const doc = new jsPDF();
  const values = data.map((d) => d.value);
  const minVal = Math.min(...values).toFixed(2);
  const maxVal = Math.max(...values).toFixed(2);
  const avgVal = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);

  doc.setFontSize(18);
  doc.setTextColor(217, 119, 6);
  doc.text("Relatorio de Historico - Forno Industrial", 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Variavel Analisada: ${fieldName}`, 14, 28);
  doc.text(`Data do Relatorio: ${new Date().toLocaleString('pt-BR')}`, 14, 34);

  doc.setLineWidth(0.5);
  doc.line(14, 38, 196, 38);

  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text("Resumo Operacional:", 14, 46);

  doc.setFontSize(10);
  doc.text(`* Total de Registros: ${data.length} leituras`, 20, 54);
  doc.text(`* Valor Minimo Lido: ${minVal}`, 20, 60);
  doc.text(`* Valor Maximo Lido: ${maxVal}`, 20, 66);
  doc.text(`* Media do Periodo: ${avgVal}`, 20, 72);
  doc.text(`* Faixa Operacional Configurada: ${minLimit} ate ${maxLimit}`, 20, 78);

  doc.line(14, 84, 196, 84);

  doc.setFontSize(12);
  doc.text("Ultimas Medicoes Registradas:", 14, 92);

  let y = 100;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text("Data e Hora", 20, y);
  doc.text("Valor Lido", 100, y);
  y += 6;

  const sampleData = data.slice(-15);
  sampleData.forEach((row) => {
    doc.setTextColor(0);
    doc.text(String(row.time), 20, y);
    doc.text(String(row.value), 100, y);
    y += 6;
  });

  doc.save(`relatorio_${fieldName}_${Date.now()}.pdf`);
};
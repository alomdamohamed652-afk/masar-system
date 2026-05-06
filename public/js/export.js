/**
 * export.js  —  MASAR Excel Export Utility
 * Depends on: SheetJS (xlsx) loaded globally via CDN
 *
 * Usage:
 *   exportToExcel('products')
 *   exportToExcel('orders')
 *   exportToExcel('expenses')
 *   exportToExcel('all')      ← exports all three as separate sheets in one file
 */

'use strict';

(function (global) {

  // ── Column definitions ──────────────────────────────────────────────────────

  const SCHEMAS = {
    products: {
      endpoint: '/api/products?limit=200',
      sheet:    'المنتجات',
      columns: [
        { key: 'id',          header: 'م'              },
        { key: 'code',        header: 'الكود'           },
        { key: 'barcode',     header: 'الباركود'        },
        { key: 'name',        header: 'اسم المنتج'      },
        { key: 'color',       header: 'اللون'           },
        { key: 'size',        header: 'المقاس'          },
        { key: 'cost',        header: 'سعر التكلفة'     },
        { key: 'price',       header: 'سعر البيع'       },
        { key: 'stock',       header: 'الكمية الكلية'   },
        { key: 'sold',        header: 'المباع'          },
        { key: 'remaining',   header: 'المتبقي'         },
        { key: 'created_at',  header: 'تاريخ الإضافة'   },
      ],
    },

    orders: {
      endpoint: '/api/orders?limit=200',
      sheet:    'الطلبات',
      columns: [
        { key: 'id',               header: 'م'              },
        { key: 'order_number',     header: 'رقم الأوردر'    },
        { key: 'barcode',          header: 'الباركود'        },
        { key: 'customer_name',    header: 'اسم العميل'      },
        { key: 'phone',            header: 'الهاتف'          },
        { key: 'address',          header: 'العنوان'         },
        { key: 'total',            header: 'إجمالي المنتجات' },
        { key: 'shipping_price',   header: 'الشحن'           },
        { key: 'grand_total',      header: 'الإجمالي الكلي'  },
        { key: 'status',           header: 'الحالة'          },
        { key: 'payment_status',   header: 'حالة الدفع'      },
        { key: 'payment_method',   header: 'طريقة الدفع'     },
        { key: 'items_count',      header: 'عدد الأصناف'     },
        { key: 'created_by_name',  header: 'أنشئ بواسطة'    },
        { key: 'notes',            header: 'ملاحظات'         },
        { key: 'created_at',       header: 'تاريخ الإنشاء'   },
      ],
    },

    expenses: {
      endpoint: '/api/expenses?limit=200',
      sheet:    'المصروفات',
      columns: [
        { key: 'id',          header: 'م'             },
        { key: 'type',        header: 'نوع المصروف'   },
        { key: 'details',     header: 'التفاصيل'      },
        { key: 'amount',      header: 'المبلغ'         },
        { key: 'created_at',  header: 'التاريخ'        },
      ],
    },
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function todayStr() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  function setLoadingState(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.dataset.origText = btn.textContent;
      btn.textContent = 'جاري التصدير…';
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.origText || 'تصدير Excel';
      btn.disabled = false;
    }
  }

  function applyHeaderStyle(ws, range, colCount) {
    // Header row is row 1 (index 0 in SheetJS)
    for (let c = 0; c < colCount; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r: 0, c });
      if (!ws[cellAddr]) continue;
      ws[cellAddr].s = {
        font:      { bold: true, color: { rgb: 'FFFFFF' }, name: 'Arial', sz: 11 },
        fill:      { patternType: 'solid', fgColor: { rgb: '1F4E79' } },
        alignment: { horizontal: 'center', vertical: 'center', readingOrder: 2 },
        border: {
          bottom: { style: 'thin', color: { rgb: 'AAAAAA' } },
        },
      };
    }
  }

  function applyBodyStyle(ws, rowCount, colCount) {
    for (let r = 1; r <= rowCount; r++) {
      const isEven = r % 2 === 0;
      for (let c = 0; c < colCount; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r, c });
        if (!ws[cellAddr]) ws[cellAddr] = { t: 'z', v: '' };
        ws[cellAddr].s = {
          font:      { name: 'Arial', sz: 10 },
          fill:      isEven
            ? { patternType: 'solid', fgColor: { rgb: 'EBF3FB' } }
            : { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
          alignment: { horizontal: 'right', vertical: 'center', readingOrder: 2 },
        };
      }
    }
  }

  function autoWidths(ws, rows, columns) {
    const widths = columns.map(col => {
      const headerLen = col.header.length * 2;          // Arabic chars are wider
      const maxData   = rows.reduce((m, row) => {
        const v = row[col.key];
        const l = v != null ? String(v).length : 0;
        return Math.max(m, l);
      }, 0);
      return { wch: Math.max(headerLen, maxData, 10) };
    });
    ws['!cols'] = widths;
  }

 async function fetchAll(baseEndpoint) {
  const token = localStorage.getItem('masar_token');
  const separator = baseEndpoint.includes('?') ? '&' : '?';

  // أول صفحة
  const first = await fetch(`${baseEndpoint}${separator}page=1&limit=200`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!first.ok) throw new Error(`HTTP ${first.status}`);
  const firstJson = await first.json();
  if (!firstJson.success) throw new Error(firstJson.message || 'فشل جلب البيانات');

  const rows = [...firstJson.data];
  const totalPages = firstJson.pagination?.pages || 1;

  // باقي الصفحات
  if (totalPages > 1) {
    const pagePromises = [];

    for (let p = 2; p <= totalPages; p++) {
      pagePromises.push(
        fetch(`${baseEndpoint}${separator}page=${p}&limit=200`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }).then(r => r.json())
      );
    }

    const rest = await Promise.all(pagePromises);
    rest.forEach(j => {
      if (j.success && j.data) rows.push(...j.data);
    });
  }

  return rows;
}
  // ── Build a single worksheet from schema + rows ─────────────────────────────

  function buildSheet(schema, rows) {
    const headers  = schema.columns.map(c => c.header);
    const dataRows = rows.map(row =>
      schema.columns.map(col => {
        const v = row[col.key];
        return v != null ? v : '';
      })
    );

    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws['!sheetView'] = { rightToLeft: true };
    ws['!freeze']    = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
    autoWidths(ws, rows, schema.columns);
    applyHeaderStyle(ws, ws['!ref'], schema.columns.length);
    applyBodyStyle(ws, dataRows.length, schema.columns.length);
    return ws;
  }

  // ── Main export function ────────────────────────────────────────────────────

  async function exportToExcel(type, triggerBtn = null) {
    if (typeof XLSX === 'undefined') {
      alert('مكتبة xlsx غير محملة. يرجى التأكد من تضمينها في الصفحة.');
      return;
    }

    const btn = triggerBtn || document.querySelector(`[data-export="${type}"]`);
    setLoadingState(btn, true);

    try {
      const wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };

      // Resolve which schemas to export
      const types = type === 'all'
        ? ['products', 'orders', 'expenses']
        : [type];

      if (types.some(t => !SCHEMAS[t])) {
        console.error(`exportToExcel: unknown type "${type}"`);
        return;
      }

      // Fetch all schemas in parallel
      const results = await Promise.all(
        types.map(t => fetchAll(SCHEMAS[t].endpoint).then(rows => ({ t, rows })))
      );

      let hasData = false;
      results.forEach(({ t, rows }) => {
        if (!rows.length) return;
        hasData = true;
        XLSX.utils.book_append_sheet(wb, buildSheet(SCHEMAS[t], rows), SCHEMAS[t].sheet);
      });

      if (!hasData) {
        alert('لا توجد بيانات للتصدير');
        return;
      }

      XLSX.writeFile(wb, `MASAR-${todayStr()}.xlsx`);

    } catch (e) {
      console.error('exportToExcel error:', e);
      alert(`فشل التصدير: ${e.message}`);
    } finally {
      setLoadingState(btn, false);
    }
  }

  // ── Expose globally ─────────────────────────────────────────────────────────
  global.exportToExcel = exportToExcel;

  // ── Auto-bind data-export buttons on DOMContentLoaded ──────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-export]').forEach(btn => {
      btn.addEventListener('click', function () {
        exportToExcel(this.dataset.export, this);
      });
    });
  });

})(window);

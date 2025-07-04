document.addEventListener('DOMContentLoaded', function () {
"use strict";
var bdcArray, gcArray, gcPropertyId = 14;
const otaReportBase = 'https://guestcentrix.hihostels.ca/hostel.web/Reporting/';
const otaReportPath = 'Preview?pathName=2.%20Custom%20Reports%5CHI%20CANADA%5CHI%20Canada%20Month%20End%5COTA%20Commission%20%28HI%20Canada%29';
const otaReportLink = document.getElementById('gc-ota-link');
const fileBDC = document.getElementById('fileBDC');
const fileGC = document.getElementById('fileGC');
const selectPropertyId = document.getElementById('gc-id');
fileBDC.addEventListener('change', function () {
    const reader = new FileReader();
    reader.onload = e => {
        bdcArray = parseCSV(e.target.result);
        createTable(false);
    };
    reader.readAsText(fileBDC.files[0]);
});
fileGC.addEventListener('change', function () {
    const reader = new FileReader();
    reader.onload = e => {
        gcArray = parseCSV(e.target.result);
        createTable(false);
    };
    reader.readAsText(fileGC.files[0]);
});
const hotelid = document.getElementById('hotelid');
hotelid.addEventListener('change', function () {
    createTable(false);
});
const expediaIds = {
    14: 7700310, // Banff
    7: 48288710,  // Calgary
    10: 48288685, // Edmonton
    4: null, //Jasper
    8: null, //Lake louise
    2: null, //Vancouver downtown
    1: null, // Vancouver jericho beach
    5: 48288516,  // Whistler
    15: 111857959, // Nova scotia
}
selectPropertyId.addEventListener('change', function () {
    gcPropertyId = selectPropertyId.value;
    if (storageAvailable()) {
        window.localStorage.setItem('reconciliationPropertyId', gcPropertyId);
    }
    hotelid.value = expediaIds[gcPropertyId];
    createTable(false);
});
const hotelid_span = document.getElementById('hotelid_span');
const expediarate = document.getElementById('expediarate');
expediarate.addEventListener('change', function () {
    createTable(false);
});
const expediarate_span = document.getElementById('expediarate_span');

if (storageAvailable()) {
    const pId = window.localStorage.getItem('reconciliationPropertyId');
    if (pId) {
        selectPropertyId.value = gcPropertyId = pId;
        hotelid.value = expediaIds[pId];
    }
}

let totalComm;
let reportType;
function createTable(showErrors = true) {
  const errorElem = document.getElementById("error");
  if (errorElem) errorElem.innerHTML = "";

  try {
    totalComm = 0;
    reportType = 'BDC';
    if (bdcArray === undefined) return;
    let minCols, jAmt;
    let jArr, jDep, jName, jPct, jPID, jComm;
    let kPct = 15;

    if (bdcArray[0][0] === 'Reservation number') {
      minCols = 19;
      jAmt = 12;
      jName = 6;
      jPct = 10;
      jComm = 13;
      jPID = 17;
      jArr = 3;
      jDep = 4;
    } else if (bdcArray[0][0] === 'Book number') {
      minCols = 15;
      jAmt = 12;
      jName = 2;
      jPct = 13;
      jComm = 14;
      jArr = 3;
      jDep = 4;
    } else if (bdcArray[0][0] === 'Reservation ID') {
      reportType = 'EXP';
      minCols = 7;
      jArr = 1;
      jDep = 2;
      jName = 3;
      jComm = 6;
      jAmt = 8;
      expediarate.value = expediarate.value.replace(/\D/g, '');
      kPct = parseInt(expediarate.value) || 15;
      if (kPct < 15) kPct = 15;
      else if (kPct > 40) kPct = 40;
      expediarate.value = kPct;
    } else {
      minCols = 10000;
    }

    hotelid_span.style.display = reportType === 'EXP' ? 'inline' : 'none';
    expediarate_span.style.display = reportType === 'EXP' ? 'inline' : 'none';
    hotelid.value = hotelid.value.replace(/\D/g, '');
    if (hotelid.value === '') hotelid.value = '38769067';

    if (gcArray === undefined) return;
    const button = document.getElementById('reconcile-button');
    button.disabled = false;
    const checkbox = document.getElementById('showall');
    checkbox.disabled = false;
    let showAllRows = checkbox.checked;

    const tableElem = document.getElementById("tbl");
    if (!tableElem) throw new Error("Missing table element with id='tbl'");

    // collect folio data from the GC export
    const gcData = {}; // BDC# => array of info
    //const seenBDC = {};
    for (const row of gcArray) {
        if (row.length < 19) continue;
        // columns:
        //  0: BDC-*
        //  3: name
        //  7: arrival
        // 11: departure
        // 12: final amt
        // 16: folio status
        // 18: folio ID
        if (!/^(BDC|EXP)-/.test(row[0])) continue;
        const m = row[0].match(/\d+/); // extract the first group of digits. Don't rely on this GC column to be well-formed/unedited
        if (m === null) continue;
        const id = m[0];
        if (!/^[0-9]{6,}$/.test(id)) continue; // column 0 should be BDC number, ten+ digits; or EXP number 6+ digits
        const amt = parseFloat(row[12].replace(/^\$/, '')); // strip dollar sign, then convert to number
        const folioID = row[18];
        const status = row[16];
        if (id in gcData) {
            // for minigroups, sum up the total, and keep a list of the folio ID's and statuses
            const h = gcData[id];
            h[0] += amt;
            h[1].push(folioID);
            h[2].push(status);
            // usually the arrival/departure dates should be the same, but store these as a set just in case
            h[3].add(row[7]);
            h[4].add(row[11]);
        } else {
            gcData[id] = [amt, [folioID], [status], new Set([row[7]]), new Set([row[11]])];
        }
    }
    if (Object.keys(gcData).length === 0) {
        if (showErrors) {
            errorElem.innerHTML = 'No usable data found in the GC file. Make sure you selected the right file ("OTA Commission (HI USA).csv" by default).';
        }
        return;
    }

    // BDC first pass: store all rows where the GC total is less than the BDC total
    const stayedMaybeMerged = [];
    const canceledMaybeMerged = {}; // hash of possible merged reservations, identified by (lowercased) BDC guest name
    const results = [];
    for (let i = 1, row; row = bdcArray[i]; ++i) {
        if (row.length < minCols) continue;
        if (!/^[0-9]{6,}$/.test(row[0])) continue; // column 0 should be BDC number, ten+ digits; or EXP number 6+ digits
        //seenBDC[row[0]] = true;

        let amt, commission;
        if (reportType === 'BDC') {
            amt = parseFloat(row[jAmt]);
            commission = parseFloat(row[jComm]); // for the Reservations exports, there's no "final amount" field ("amt" is the price field), but the commission amount field will be blank if the guest canceled and the fee was waived
        } else {
            const reconciled = parseFloat(row[jComm + 1]);
            if (Number.isNaN(reconciled)) {
                // for Expedia, calculate the stay amount from the commission
                commission = parseFloat(row[jComm]);
                amt = Math.round(commission * 10000 / kPct) / 100;
            } else {
                // but if there's already a reconciled amount in the report, use that instead
                // btw this amount appears to be post-tax for stays, and pre-tax for cancellations
                // it doesn't matter too much for our purposes
                // because we'll usually be downloading the report from expedia *before* reconciliation is done
                amt = reconciled;
                commission = reconciled * kPct / 100;
            }
        }
        if (amt == 0) continue; // skip if BDC doesn't think we owe commission
        if (!commission) continue;
        if (row[jName] === '') {
            row[jName] = row[jName - 1]; // if "guest name" is empty, fall back to "booker name"
        }
        row[jAmt] = amt;
        row.push(i + 1); // save the line number from BDC file

        const id = row[0];
        if (id in gcData && !showAllRows) {
            const gcAmt = parseFloat(gcData[id][0]);
            if (Math.abs(amt - gcAmt) < 0.42) continue; // skip if guest paid the same (or more, see below) than what BDC statement says
            // can't use === here because floating point comparisons with minigroup totals could fail
            // 2024-12-01: but actually just skip small discrepancies because it's not worth the time to save $0.07 on commission
            if (gcAmt === 0) {
                // this folio was canceled, so save it in case it was merged
                const ident = row[jName].toLowerCase();
                if (ident in canceledMaybeMerged) {
                    canceledMaybeMerged[ident].push(row);
                } else {
                    canceledMaybeMerged[ident] = [row];
                }
            } else if (amt < gcAmt) {   // but if it's more, save it in case it was merged with another folio
                stayedMaybeMerged.push(row);
                continue;
            }
        }
        results.push(row);
    }
    if (results.length === 0) {
        if (showErrors) {
            errorElem.innerHTML = 'No results found in the BDC file.';
        }
        return;
    }

    // merged folio handling
    // Go through list reservations where GC amount is greater than BDC amount. The GC amount might include reservations that were merged.
    // We look for reservations where the name is the same and the dates stayed overlap with the GC dates stayed.
    // (I don't consider these critera quite unique enough to guarantee that the result will be 100% accurate, so we output these for human review)
    const bdcMerges = {}; // BDC id => list of rows
    const rowsToRemove = new Set();
    for (const row of stayedMaybeMerged) {
        const ident = row[jName].toLowerCase();
        if (!(ident in canceledMaybeMerged)) continue;

        // add row back to results if there are canceled folios with the same name AND overlapping stay date
        const id = row[0];
        const arr = Array.from(gcData[id][3]).sort()[0]; // arrival date, according to GC (technically, the earliest arrival date if the BDC id corresponds to a GC minigroup)
        const dep = Array.from(gcData[id][4]).sort().at(-1); // GC departure date (technically, the latest departure date if there's a minigroup)
        let showRow = false;
        for (const r of canceledMaybeMerged[ident]) {
            if (r[3] < dep && r[4] > arr) {
                showRow = true;
                if (id in bdcMerges) {
                    bdcMerges[id].push(r);
                } else {
                    bdcMerges[id] = [r];
                }
                rowsToRemove.add(r[0]);
            }
        }
        // insert this extra row in the right place (row number is stored in last item of the "row" array). The "results" array is already ordered by row number
        if (showRow) binaryInsert(results, row, (a, b) => a[a.length - 1] - b[b.length - 1]);
        // for a small number of inserts, probably more efficient to binary insert into the already-sorted array, so I switched to doing that instead of pushing, then sorting
    }

    // second pass: output table, inserting possible merged folios
    const today = Date.now();
    const endOfLastMonth = new Date(); endOfLastMonth.setDate(0);
    const bdcPropertyIds = {
        14: 264930, // Banff
        7: 1,  // Calgary
        10: 1, // Edmonton
        4: 1,  // Jasper
        8: 1,  // Lake Louise
        2: 1,  // Vancouver Downtown
        1: 1,  // Jericho Beach
        5: 1,  // Whistler
        15: 1  // Nova Scotia
    };
    let content = tableHeader(reportType);
    for (const row of results) {
        const id = row[0];
        if (rowsToRemove.has(id)) continue;
        const name = row[jName];
        const amt = row[jAmt];
        let arr = '';
        let dep = '';

        let gcAmt;
        let folios;
        let statuses = [];
        let gcArr = [];
        let gcDep = [];
        if (id in gcData) {
            gcAmt = gcData[id][0];
            folios = gcData[id][1];
            statuses = gcData[id][2];
            gcArr = gcData[id][3];
            gcDep = gcData[id][4];
        } else {
            // the expedia report includes unreconciled reservations from this month, so skip these
            if (Date.parse(row[jArr]) > endOfLastMonth) continue;
            if (Date.parse(row[jDep]) > today) continue;
        }
        const isMerge = id in bdcMerges;
        if (showAllRows || isMerge || !(id in gcData) || statuses.includes("Stayed")) {
            arr = row[jArr];
            dep = row[jDep];
        }
        let mergeTotal, nRows;
        if (isMerge) {
            mergeTotal = bdcMerges[id].reduce((subtotal, row) => subtotal + row[jAmt], amt);
            nRows = bdcMerges[id].length + 1;
        }
        const propertyID = jPID ? row[jPID] : reportType === 'BDC' ? bdcPropertyId : hotelid.value;
        content += tableRow(reportType, row.at(-1), id, propertyID, name, arr, dep, amt, jPct ? row[jPct] : kPct, gcAmt, gcArr, gcDep, folios, statuses, isMerge, mergeTotal, nRows);
        if (isMerge) {
            for (const row of bdcMerges[id].sort((a, b) => a[jArr].localeCompare(b[jArr]))) {
                const id = row[0];
                content += tableRow(reportType, row.at(-1), id, propertyID, '"', row[jArr], row[jDep], row[jAmt], jPct ? row[jPct] : kPct,
                    gcData[id][0], gcData[id][3], gcData[id][4], gcData[id][1], gcData[id][2]);
            }
        }
    }
    content += '<tr><td></td><td></td><td></td><td></td><td></td><td colspan="2"></td><td></td>'
        + "<td><b>$" + (totalComm / 100).toFixed(2) + "</b></td>"
        + '<td colspan="4">' + (showAllRows ? "total in extra commissions (ignoring merged folios)" : "You could save at least this much in commissions!") + '</td>'
        + "</tr>";

    // Possible early checkouts: GC folios with no corresponding line in the BDC file
    // disable this for now, these should show up in the BDC report for the following month
    //     const currentMonth = results[0][4].match(/(-)(\d\d)/)[2];
    //     const hotelId = jPID ? results[0][jPID] : 270216;
    //     for (const [id, row] of Object.entries(gcData)) {
    //         if (seenBDC[id]) continue;
    //         const arrMonth = Array.from(row[3])[0].match(/(-)(\d\d)/)[2];
    //         if (arrMonth !== currentMonth) continue;
    //         const depMonth = Array.from(row[4])[0].match(/(-)(\d\d)/)[2];
    //         if (arrMonth !== depMonth) continue;
    //         content += tableRow(reportType, '', id, hotelId, 'Not in the BDC report.', '', '', '', '',
    //                                 parseFloat(row[0]), row[3], row[4], row[1], row[2]);
    //     }

    document.getElementById("tbl").innerHTML = content;
 } catch (err) {
    console.error(err);
    if (errorElem) errorElem.innerHTML = `Error: ${err.message}`;
  }
} 
window.createTable = createTable;

function tableRow(ota, line, id, hotel_id, name, arr, dep, amt, pct, gcAmt, gcArr, gcDep, folios, statuses, isMerge, mergeTotal, nRows) {
    const mergeSupport = name === '"';
    let comm = '';
    amt = parseFloat(amt); // among other reasons, the "Reservations" export has this column as "xyz USD"
    const cmpAmt = isMerge ? mergeTotal : amt;
    if (gcAmt !== undefined && !mergeSupport && (cmpAmt - gcAmt) > 0.01) {
        comm = ((cmpAmt - gcAmt) * pct / 100);
        totalComm += Math.round(comm * 100); // add up in cents, as integer
        comm = comm.toFixed(2);
    }
    name = name.replace("\n", "<br>");
    let result = "<tr" + (isMerge ? ' class="merge0"' : mergeSupport ? ' class="merged"' : '') + ">"
        + "<td>" + line + "</td>"
        + '<td><a href="' + propertyLink(id, reportType, hotel_id) + '" target="bdc-context">'
        + id + '</a></td>'
        + (isMerge ? `<td rowspan="${nRows}">${name}</td>` : mergeSupport ? '' : `<td>${name}</td>`)
        + "<td>" + arr + "</td>"
        + "<td>" + dep + "</td>"
        + (isMerge ? `<td rowspan="${nRows}">` + mergeTotal.toFixed(2) + '</td><td>'
            : mergeSupport ? '<td>'
                : '<td colspan="2">')
        + (line === '' ? '' : amt.toFixed(2)) + "</td>";
    if (folios === undefined) {
        if (ota === 'EXP') result += '<td></td>';
        result += '<td></td><td></td><td></td><td></td><td colspan="2">Not in the GC report. Try <a href="' + gcVoucherLink(id, reportType) + `" target="gc-context">${reportType}-${id}</a></td>`;
    } else {
        if (ota === 'EXP') {
            if (gcAmt === undefined) {
                result += '<td></td>';
            } else if (gcAmt > 0) {
                let calcPct = amt * pct / gcAmt;
                result += '<td>' + Math.round(calcPct) + '</td>';
            } else {
                result += '<td>∞</td>';
            }
        }
        result += "<td>" + (gcAmt === undefined ? '' : gcAmt.toFixed(2)) + "</td>"
            + '<td>' + comm + '</td>';
        const didStay = statuses.includes("Stayed");
        const join_nobr = s => Array.from(s).sort().map(t => '<span class="nobr">' + t + '</span>').join(', ');
        result += "<td>" + (didStay ? join_nobr(gcArr) : '') + "</td>"
            + "<td>" + (didStay ? join_nobr(gcDep) : '') + "</td>"
            + "<td>" + folios.map(fid => { return '<a href="https://guestcentrix.hihostels.ca/hostel.web/' + gcPropertyId + '/All/Folio/Details/' + fid + '" target="gc-context">' + fid + '</a>' })
                .join(',<br>') + (folios.length > 1 ? `<br>(${folios.length} folios)` : '') + "</td>"
            + "<td>" + statuses.join(',<br>') + "</td>";
    }
    result += '<td><span></span><button class="note">Add Note...</button></td>';
    result += "</tr>";
    return result;
}
function tableHeader(ota) {
    return "<tr>"
        + "<th>line #</th>"
        + `<th>${ota}#</th>`
        + "<th>name</th>"
        + `<th>${ota} arrival</th>`
        + `<th>${ota} departure</th>`
        + `<th colspan="2">${ota} total</th>`
        + (ota === 'EXP' ? '<th>EXP %</th>' : '')
        + "<th>GC total</th>"
        + "<th>Extra Commission</th>"
        + "<th>GC arrival</th>"
        + "<th>GC departure</th>"
        + "<th>GC folio(s)</th>"
        + "<th>GC status</th>"
        + "<th>Notes</th>"
        + "</tr>";
}
document.getElementById('tbl').addEventListener('click', function (e) {
    if (e.target.className !== 'note') return;
    const btn = e.target;
    const span = btn.previousSibling;
    const s = prompt('Type note here:', span.innerText);
    if (s) {
        span.innerText = s;
        btn.innerText = 'Edit...';
    }
});
function propertyLink(id, ota, hotel_id) {
    if (ota === 'BDC') return 'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/booking.html?hotel_id=' + hotel_id + '&res_id=' + id;
    return 'https://apps.expediapartnercentral.com/lodging/reservations/reservationDetails.html?htid=' + hotel_id + '&reservationIds=' + id;
}
function gcVoucherLink(id, ota) {
    const baseURL = 'https://guestcentrix.hihostels.ca/hostel.web/';
    if (ota === 'BDC') return baseURL + gcPropertyId + '/All/Folio/FindFolio?KwAny=BDC-' + id + '&KwIsVoucher=1&KwIsAllFolio=AllFolio';
    return baseURL + gcPropertyId + '/All/Folio/FindFolio?KwAny=EXP*' + id + '&KwIsVoucher=1&KwIsAllFolio=AllFolio';
}

// parse code from https://github.com/SebastianSimon/csv-parser (and minified)
function parseCSV(g, { quote: h = '"', separators: k = [","], forceLineFeedAfterCarriageReturn: t = !0, linefeedBeforeEOF: n = !1, ignoreSpacesAfterQuotedString: u = !0, taintQuoteSeparatorLines: v = !1 } = {}) {
    const p = (() => { const a = b => "string" === typeof b && 1 >= b.length; return b => "string" === typeof b ? Array.from(b) : Array.isArray(b) ? b.filter(a) : [] })(), q = a => "" !== a && "\n" !== a && "\r" !== a, w = /\r\n|\r/g, x = /\r\n|\n\r|\r/g, y = a => { if (1 === a.length) return a[0]; if (a.includes("s")) { if (a.includes("q") && !a.includes("p")) return "q"; if (!a.includes("q") && a.includes("p")) return "p" } if (a.includes("q") && a.includes("p")) return "r" },
        z = (() => { const a = { y: { f: "z", o: "x", q: "y", r: "z", p: "z", s: "y" }, x: { f: "x", o: "x", q: "w", r: "w", p: "x", s: "x" }, v: { f: "z", o: "v", q: "v", r: "z", p: "z", s: "v" }, u: { f: "z", o: "v", q: "x", r: "x", p: "z", s: "u" }, w: { f: "z", o: "x", q: "x", r: "x", p: "z", s: "y" } }; return (b, d) => { if ("e" === b) { if ("f" === d) return "g"; b = "u" } return a[b][d] } })(),
        { A } = (() => {
            if (!RegExp.hasOwnProperty("escape")) { const b = /[\\^$*+?.()|[\]{}]/g; Object.defineProperty(RegExp, "escape", { configurable: !0, enumerable: !1, writable: !0, value: Object.freeze({ escape(d) { return String(d).replace(b, "\\$&") } }).escape }) } const { a } = {
                a(b) {
                    const { q: d, i: m } = this, f = new RegExp(`^ *${RegExp.escape(d)}([\\s\\S]*)${RegExp.escape(d)}( *)$`), c = /^ ([\s\S]*) $/, e = new RegExp(`(${RegExp.escape(d)})\\1`, "g");
                    return " " !== d && f.test(b) ? b.replace(f, "$1" + (m ? "" : "$2")).replace(e, "$1") : " " === d && c.test(b) ? b.replace(c, "$1").replace(e, "$1") : b
                }
            }; return { A(b) { return b.map(a, this) } }
        })(), l = (a, b) => { a = a.array[a.array.length - 1]; a[a.length - 1] += b }, r = (a, b) => { "r" === b ? a.t = "a" : "p" === b && (a.t = "b") };
    g = g.replace(t ? w : x, "\n"); g += n && g.endsWith("\n") ? "" : "\n"; g = g.replaceAll("\x00", ""); h = p(h).filter(q)[0] ?? ""; k = p(k).filter(q); return Array.from(g).reduce((a, b, d, m) => {
        var f = a.q, c = a.m; const e = []; "\n" === b ? e.push("f") : (b === f && e.push("q"), c.includes(b) && e.push("p"), " " === b && e.push("s")); 0 === e.length && e.push("o"); f = y(e); c = z(a.k, f); if (a.j) {
            if ("z" === c && "f" !== f && ("y" === a.k || "w" === a.k)) r(a, f);
            else if ("z" === c || "g" === c) "f" === f ? a.t = "n" : "n" !== a.t && r(a, f); "f" === f && "a" === a.t && ("x" === c ? (l(a, a.q), c = "z", a.t = "n") : "w" === c && (c = "g", a.t = "n"))
        } a.k = c; "g" === a.k && (1 < a.array[a.array.length - 1].length && a.array[a.array.length - 1].pop(), a.k = "z", a.t = "n"); d !== m.length - 1 ? "z" === a.k ? (e.includes("p") ? a.array[a.array.length - 1].push("") : e.includes("f") && (a.array.push([""]), a.t = "n"), a.k = "e") : l(a, b) : "x" === a.k && (a.l && l(a, b), l(a, a.q)); return a
    }, { array: [[""]], k: "e", q: h, m: k, l: n, j: v && k.includes(h), t: "n" }).array.map(A, { i: u, q: h })
}

function binaryInsert(a, b, e) { if (0 < e(a[0], b)) a.splice(0, 0, b); else if (0 > e(a[a.length - 1], b)) a.splice(a.length, 0, b); else { for (var d = 0, c = a.length, g = 0, h = c; d < c;) { var f = Math.floor((c + d) / 2), k = e(a[f], b); 0 > k ? d = f : 0 < k && (c = f); if (g === d && h === c) break; g = d; h = c } a.splice(c, 0, b) } };

function storageAvailable() { let e; try { e = window.localStorage; const t = "__test__"; return e.setItem(t, t), e.removeItem(t), !0 } catch (t) { return t instanceof DOMException && "QuotaExceededError" === t.name && e && 0 !== e.length } }

function updateOTAReportLink(propertyId) {
    otaReportLink.href = `${otaReportBase}${propertyId}/All/Report/${otaReportPath}`;
    otaReportLink.style.display = 'inline-block';
}

// Update the link when a new hostel is selected
selectPropertyId.addEventListener('change', function () {
    gcPropertyId = selectPropertyId.value;
    hotelid.value = expediaIds[gcPropertyId];
    createTable(false);
    updateOTAReportLink(gcPropertyId); // Add this
});

// Set initial state (if saved in localStorage or default)
if (gcPropertyId) {
    updateOTAReportLink(gcPropertyId);
}

// version 2.0 by Dominic Yu, 2023-05-08 (version 1.0 can be considered as the various Excel scripts previously used)
// 2.1, 2023-05-31: added ability to read in Reservation exports as well
// 2.1.1, 2023-06-01: fixed floating point issue affecting minigroup total comparisons
// 2.2, 2023-06-04: added support for Expedia reconciliation reports
//
// 2.3, 2025-06-07: adapted for HI Canada by Danny Champion
//       - Updated styling to match HI Hostels Canada branding
//       - Replaced HI USA property list with Canadian hostels
//       - Updated GuestCentrix base URLs to use guestcentrix.hihostels.ca
//       - Cleaned up UI for clarity and accessibility
// 2.4, 2025-07-03: adapted for HI Canada by Danny Champion
//       - Bug fix, loaded the java script after the page loaded
//       - Added some error handling to the createTable function
});
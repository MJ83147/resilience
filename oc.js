const CACHE_KEY = 'oc_dashboard_cache';
const ITEMS_CACHE_KEY = 'oc_dashboard_items';

// Get API key from config.js
let apiKey = '';
try {
  if (typeof CONFIG !== 'undefined' && CONFIG.apiKey) {
    apiKey = CONFIG.apiKey;
  }
} catch (e) {
  console.error('Could not load API key from config.js');
}

// Multi-stage crimes to exclude from success/failure calculations
const MULTI_STAGE_CRIMES = [
  'stacking the deck',
  'no reserve',
  'manifest cruelty',
  'gone fission'
];

// Crime tiers - fixed tier per crime type
const CRIME_TIERS = {
  "pet project": 1,
  "cash me if you can": 1,
  "smoke and wing mirrors": 1,
  "market forces": 1,
  "mob mentality": 1,
  "best of the lot": 1,
  "honey trap": 2,
  "leave no trace": 2,
  "snow blind": 2,
  "sneaky git grab": 3,
  "no reserve": 3,
  "stacking the deck": 4,
  "ace in the hole": 4,
  "break the bank": 5,
  "bidding war": 5,
  "clinical precision": 5,
  "gaslight the way": 5,
  "stage fright": 5,
  "blast from the past": 6,
  "manifest cruelty": 6,
  "gone fission": 7
};

// CPR Requirements from userscript
const CPR_REQUIREMENTS = {
  "blast from the past": {
    "picklock #1": 60,
    "hacker": 60,
    "engineer": 62,
    "bomber": 62,
    "muscle": 62,
    "picklock #2": 50
  },
  "stacking the deck": {
    "hacker": 60,
    "imitator": 60,
    "cat burglar": 60,
    "driver": 55
  },
  "ace in the hole": {
    "hacker": 60,
    "driver": 55,
    "muscle #1": 60,
    "imitator": 60,
    "muscle #2": 60
  },
  "break the bank": {
    "robber": 60,
    "muscle #1": 60,
    "thief #1": 50,
    "muscle #2": 60,
    "muscle #3": 62,
    "thief #2": 62
  },
  "clinical precision": {
    "assassin": 60,
    "cat burglar": 65,
    "cleaner": 65,
    "imitator": 65
  },
  "stage fright": {
    "sniper": 60,
    "enforcer": 60,
    "lookout": 60,
    "muscle #1": 10,
    "muscle #2": 10,
    "muscle #3": 10
  },
  "gaslight the way": {
    "imitator #1": 60,
    "imitator #2": 60,
    "imitator #3": 60,
    "looter #1": 60,
    "looter #2": 5,
    "looter #3": 60
  },
  "bidding war": {
    "robber #1": 50,
    "robber #2": 60,
    "robber #3": 60,
    "bomber #1": 50,
    "bomber #2": 60,
    "driver": 60
  },
  "honey trap": { "_default": 60 },
  "leave no trace": { "_default": 60 },
  "snow blind": { "_default": 60 },
  "pet project": { "_default": 30 },
  "cash me if you can": { "_default": 30 },
  "smoke and wing mirrors": { "_default": 30 },
  "market forces": { "_default": 30 },
  "mob mentality": { "_default": 30 },
  "best of the lot": { "_default": 30 },
  "no reserve": { "_default": 60 },
  "sneaky git grab": { "_default": 60 }
};

function getCPRThreshold(crimeName, position, positionNumber) {
  const crimeKey = crimeName.toLowerCase();
  const crimeReqs = CPR_REQUIREMENTS[crimeKey];
  
  if (!crimeReqs) {
    return 70;
  }
  
  if (crimeReqs._default !== undefined) {
    return crimeReqs._default;
  }
  
  const posLower = position.toLowerCase();
  const posWithNumber = `${posLower} #${positionNumber}`;
  
  if (crimeReqs[posWithNumber] !== undefined) {
    return crimeReqs[posWithNumber];
  }
  
  if (crimeReqs[posLower] !== undefined) {
    return crimeReqs[posLower];
  }
  
  if (positionNumber === 1 && crimeReqs[`${posLower} #1`] !== undefined) {
    return crimeReqs[`${posLower} #1`];
  }
  
  return 70;
}

function getCrimeTier(crimeName) {
  const tier = CRIME_TIERS[crimeName.toLowerCase()];
  return tier ? `T${tier}` : '';
}

function isMultiStageCrime(crimeName) {
  return MULTI_STAGE_CRIMES.includes(crimeName.toLowerCase());
}

let crimeExpMembers = [];
let allMembers = {};
let ongoingCrimes = [];
let completedCrimes = [];
let itemNames = {};
let currentMetric = 'respect';
let chartData = [];
let currentSort = { column: 'respect', direction: 'desc' };
let dataRange = { earliest: null, latest: null, crimeCount: 0 };

function showTab(tabId, btnId) {
  document.querySelectorAll('.tab-section').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-buttons button').forEach(btn => btn.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  document.getElementById(btnId).classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!apiKey) {
    document.getElementById('loadingMessage').style.display = 'none';
    document.getElementById('errorMessage').style.display = 'block';
    document.getElementById('errorMessage').textContent = 'Error: Missing config.js or API key. Create a config.js file with: const CONFIG = { apiKey: "your-key-here" };';
    return;
  }

  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    const data = JSON.parse(cached);
    const age = Date.now() - data.timestamp;
    if (age < 3600000) {
      loadFromCache(data);
      return;
    }
  }
  
  loadData();
});

function loadFromCache(data) {
  crimeExpMembers = data.crimeExpMembers;
  allMembers = data.allMembers;
  ongoingCrimes = data.ongoingCrimes;
  completedCrimes = data.completedCrimes;
  dataRange = data.dataRange || { earliest: null, latest: null, crimeCount: 0 };

  const itemsCache = localStorage.getItem(ITEMS_CACHE_KEY);
  if (itemsCache) {
    itemNames = JSON.parse(itemsCache);
  }

  document.getElementById('setupSection').style.display = 'none';
  document.getElementById('dashboardContent').style.display = 'block';
  document.getElementById('factionName').textContent = data.factionName || 'Your Faction';
  updateLastUpdated(data.timestamp, dataRange);

  processAndRender();
}

function updateLastUpdated(timestamp, range) {
  let text = `Updated: ${new Date(timestamp).toLocaleString()}`;
  if (range && range.earliest && range.latest) {
    const earliest = new Date(range.earliest * 1000).toLocaleDateString();
    const latest = new Date(range.latest * 1000).toLocaleDateString();
    text += ` | Data: ${earliest} - ${latest} (${range.crimeCount} crimes)`;
  }
  document.getElementById('lastUpdated').textContent = text;
}

function switchMetric(metric) {
  currentMetric = metric;
  document.querySelectorAll('.chart-filters .filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.metric === metric);
  });
  renderMetricChart(chartData);
}

async function loadData() {
  if (!apiKey) {
    document.getElementById('loadingMessage').style.display = 'none';
    document.getElementById('errorMessage').style.display = 'block';
    document.getElementById('errorMessage').textContent = 'Error: No API key configured.';
    return;
  }

  document.getElementById('loadingMessage').style.display = 'block';
  document.getElementById('errorMessage').style.display = 'none';

  try {
    const crimeExpRes = await fetch(`https://api.torn.com/v2/faction/?selections=crimeexp&key=${apiKey}`);
    const crimeExpData = await crimeExpRes.json();

    if (crimeExpData.error) {
      throw new Error(crimeExpData.error.error);
    }

    crimeExpMembers = crimeExpData.crimeexp || [];

    const basicRes = await fetch(`https://api.torn.com/faction/?selections=basic&key=${apiKey}`);
    const basicData = await basicRes.json();

    if (basicData.error) {
      throw new Error(basicData.error.error);
    }

    allMembers = basicData.members || {};
    const factionName = basicData.name || 'Your Faction';

    let allCrimes = [];
    let offset = 0;
    const maxOffset = 500;
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    let oldestFetched = Date.now() / 1000;

    while (offset < maxOffset) {
      const crimesRes = await fetch(`https://api.torn.com/v2/faction/crimes?key=${apiKey}&offset=${offset}`);
      const crimesData = await crimesRes.json();

      if (crimesData.error) {
        throw new Error(crimesData.error.error);
      }

      const crimes = crimesData.crimes || [];
      if (crimes.length === 0) break;

      allCrimes = allCrimes.concat(crimes);

      crimes.forEach(c => {
        if (c.executed_at && c.executed_at < oldestFetched) {
          oldestFetched = c.executed_at;
        }
        if (c.created_at && c.created_at < oldestFetched) {
          oldestFetched = c.created_at;
        }
      });

      if (oldestFetched < thirtyDaysAgo) break;

      offset += crimes.length;
      await new Promise(r => setTimeout(r, 100));
    }

    ongoingCrimes = allCrimes.filter(c => c.executed_at === null && c.status !== 'Expired');
    completedCrimes = allCrimes.filter(c => c.executed_at !== null);

    let earliestDate = null;
    let latestDate = null;
    completedCrimes.forEach(c => {
      if (!earliestDate || c.executed_at < earliestDate) earliestDate = c.executed_at;
      if (!latestDate || c.executed_at > latestDate) latestDate = c.executed_at;
    });

    dataRange = {
      earliest: earliestDate,
      latest: latestDate,
      crimeCount: allCrimes.length
    };

    const itemIds = new Set();
    completedCrimes.forEach(crime => {
      if (crime.rewards?.items) {
        crime.rewards.items.forEach(item => itemIds.add(item.id));
      }
    });
    ongoingCrimes.forEach(crime => {
      crime.slots.forEach(slot => {
        if (slot.item_requirement?.id) {
          itemIds.add(slot.item_requirement.id);
        }
      });
    });

    if (itemIds.size > 0) {
      try {
        const itemsRes = await fetch(`https://api.torn.com/torn/?selections=items&key=${apiKey}`);
        const itemsData = await itemsRes.json();
        if (itemsData.items) {
          itemIds.forEach(id => {
            if (itemsData.items[id]) {
              itemNames[id] = itemsData.items[id].name;
            }
          });
          localStorage.setItem(ITEMS_CACHE_KEY, JSON.stringify(itemNames));
        }
      } catch (e) {
        console.warn('Could not fetch item names:', e);
      }
    }

    const cacheData = {
      timestamp: Date.now(),
      factionName,
      crimeExpMembers,
      allMembers,
      ongoingCrimes,
      completedCrimes,
      dataRange
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));

    document.getElementById('setupSection').style.display = 'none';
    document.getElementById('dashboardContent').style.display = 'block';
    document.getElementById('factionName').textContent = factionName;
    updateLastUpdated(Date.now(), dataRange);

    processAndRender();

  } catch (err) {
    console.error('Error loading data:', err);
    document.getElementById('loadingMessage').style.display = 'none';
    document.getElementById('errorMessage').style.display = 'block';
    document.getElementById('errorMessage').textContent = `Error: ${err.message}`;
  }
}

async function refreshData() {
  document.getElementById('setupSection').style.display = 'block';
  document.getElementById('dashboardContent').style.display = 'none';
  document.getElementById('loadingMessage').style.display = 'block';
  document.getElementById('errorMessage').style.display = 'none';
  await loadData();
}

function processAndRender() {
  const membersInCrimes = new Map();

  ongoingCrimes.forEach(crime => {
    crime.slots.forEach(slot => {
      if (slot.user?.id) {
        membersInCrimes.set(slot.user.id, {
          crimeId: crime.id,
          crimeName: crime.name,
          difficulty: crime.difficulty || crime.level || null,
          position: slot.position,
          positionNumber: slot.position_number || 1,
          passRate: slot.checkpoint_pass_rate,
          itemRequired: slot.item_requirement,
          joinedAt: slot.user.joined_at
        });
      }
    });
  });

  const lastParticipation = new Map();
  completedCrimes.forEach(crime => {
    crime.slots.forEach(slot => {
      if (slot.user?.id) {
        const existing = lastParticipation.get(slot.user.id);
        if (!existing || crime.executed_at > existing) {
          lastParticipation.set(slot.user.id, crime.executed_at);
        }
      }
    });
  });

  // 1. Not in an OC
  const notInOc = crimeExpMembers
    .filter(id => !membersInCrimes.has(id))
    .map(id => ({
      id,
      name: allMembers[id]?.name || `Unknown [${id}]`,
      lastOc: lastParticipation.get(id) || null
    }))
    .sort((a, b) => {
      if (!a.lastOc && !b.lastOc) return 0;
      if (!a.lastOc) return -1;
      if (!b.lastOc) return 1;
      return a.lastOc - b.lastOc;
    });

  renderNotInOc(notInOc);

  // 2. Missing items
  const missingItems = [];
  membersInCrimes.forEach((data, id) => {
    if (data.itemRequired && !data.itemRequired.is_available) {
      missingItems.push({
        id,
        name: allMembers[id]?.name || `Unknown [${id}]`,
        crimeName: data.crimeName,
        difficulty: data.difficulty,
        itemId: data.itemRequired.id
      });
    }
  });

  renderMissingItems(missingItems);

  // 3. Below CPR threshold
  const lowSuccess = [];
  membersInCrimes.forEach((data, id) => {
    if (data.passRate !== null) {
      const threshold = getCPRThreshold(data.crimeName, data.position, data.positionNumber);
      if (data.passRate < threshold) {
        lowSuccess.push({
          id,
          name: allMembers[id]?.name || `Unknown [${id}]`,
          crimeName: data.crimeName,
          difficulty: data.difficulty,
          position: data.position,
          positionNumber: data.positionNumber,
          passRate: data.passRate,
          threshold: threshold
        });
      }
    }
  });
  lowSuccess.sort((a, b) => (a.passRate - a.threshold) - (b.passRate - b.threshold));

  renderLowSuccess(lowSuccess);

  // 4. Rewards
  renderRewards();

  // 5. Details
  renderDetails();
}

function copyMessage(event, text, url) {
  event.preventDefault();
  
  navigator.clipboard.writeText(text).then(() => {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <p>Message copied to clipboard</p>
      <a href="${url}" target="_blank" class="toast-btn">Open Torn Message</a>
      <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
    `;
    document.body.appendChild(toast);
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

function renderNotInOc(members) {
  const list = document.getElementById('notInOcList');
  const countEl = document.getElementById('notInOcCount');

  countEl.textContent = members.length;
  countEl.classList.toggle('ok', members.length === 0);

  if (members.length === 0) {
    list.innerHTML = '<li class="empty-state">Everyone is in an OC</li>';
    return;
  }

  list.innerHTML = members.map(m => {
    let lastOcText;
    let warningClass = '';
    
    if (m.lastOc) {
      lastOcText = formatTimeAgo(m.lastOc);
    } else {
      lastOcText = 'Not in fetched data';
      warningClass = 'warning';
    }

    const messageUrl = `https://www.torn.com/messages.php#/p=compose&XID=${m.id}`;
    const messageText = `Hey ${m.name}, you're not currently in an OC. Please join one when you get a chance.`;

    return `
      <li class="issue-item">
        <span class="member-name">
          <a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank">${m.name}</a>
        </span>
        <span class="issue-detail ${warningClass}">${lastOcText}</span>
        <button class="message-btn" title="Send message" onclick="copyMessage(event, '${messageText.replace(/'/g, "\\'")}', '${messageUrl}')">✉</button>
      </li>
    `;
  }).join('');
}

function renderMissingItems(members) {
  const list = document.getElementById('missingItemsList');
  const countEl = document.getElementById('missingItemsCount');

  countEl.textContent = members.length;
  countEl.classList.toggle('ok', members.length === 0);

  if (members.length === 0) {
    list.innerHTML = '<li class="empty-state">No missing items</li>';
    return;
  }

  list.innerHTML = members.map(m => {
    const tierText = getCrimeTier(m.crimeName);
    const itemName = itemNames[m.itemId] || `Item #${m.itemId}`;
    return `
      <li class="issue-item">
        <span class="member-name">
          <a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank">${m.name}</a>
        </span>
        <span class="issue-detail warning">${m.crimeName}${tierText ? ` (${tierText})` : ''} - ${itemName}</span>
      </li>
    `;
  }).join('');
}

function renderLowSuccess(members) {
  const list = document.getElementById('lowSuccessList');
  const countEl = document.getElementById('lowSuccessCount');

  countEl.textContent = members.length;
  countEl.classList.toggle('ok', members.length === 0);

  if (members.length === 0) {
    list.innerHTML = '<li class="empty-state">No one below CPR threshold</li>';
    return;
  }

  list.innerHTML = members.map(m => {
    const tierText = getCrimeTier(m.crimeName);
    const posText = m.positionNumber > 1 ? `${m.position} #${m.positionNumber}` : m.position;
    
    const messageUrl = `https://www.torn.com/messages.php#/p=compose&XID=${m.id}`;
    const messageText = `Hey ${m.name}, your CPR for ${posText} in ${m.crimeName} is ${m.passRate}% which is below the ${m.threshold}% minimum. Please work on getting this up.`;

    return `
      <li class="issue-item">
        <span class="member-name">
          <a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank">${m.name}</a>
        </span>
        <span class="issue-detail warning">${m.passRate}% / ${m.threshold}% - ${posText} (${m.crimeName}${tierText ? ` ${tierText}` : ''})</span>
        <button class="message-btn" title="Send message" onclick="copyMessage(event, '${messageText.replace(/'/g, "\\'")}', '${messageUrl}')">✉</button>
      </li>
    `;
  }).join('');
}

// Sortable table functionality
let rewardsData = [];

function sortRewardsTable(column) {
  if (currentSort.column === column) {
    currentSort.direction = currentSort.direction === 'desc' ? 'asc' : 'desc';
  } else {
    currentSort.column = column;
    currentSort.direction = 'desc';
  }
  
  renderRewardsTable();
}

function renderRewardsTable() {
  const sorted = [...rewardsData].sort((a, b) => {
    let aVal, bVal;
    
    switch (currentSort.column) {
      case 'name':
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
        break;
      case 'count':
        aVal = a.count;
        bVal = b.count;
        break;
      case 'success':
        aVal = a.count > 0 ? a.success / a.count : 0;
        bVal = b.count > 0 ? b.success / b.count : 0;
        break;
      case 'respect':
        aVal = a.respect;
        bVal = b.respect;
        break;
      case 'avgRespect':
        aVal = a.count > 0 ? a.respect / a.count : 0;
        bVal = b.count > 0 ? b.respect / b.count : 0;
        break;
      case 'money':
        aVal = a.money;
        bVal = b.money;
        break;
      case 'avgMoney':
        aVal = a.count > 0 ? a.money / a.count : 0;
        bVal = b.count > 0 ? b.money / b.count : 0;
        break;
      default:
        aVal = a.respect;
        bVal = b.respect;
    }
    
    if (typeof aVal === 'string') {
      return currentSort.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return currentSort.direction === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const tbody = document.getElementById('rewardsTableBody');
  
  let totalCount = 0, totalSuccess = 0, totalFailed = 0, totalRespect = 0, totalMoney = 0;
  
  tbody.innerHTML = sorted.map(data => {
    totalCount += data.count;
    totalSuccess += data.success;
    totalFailed += data.failed;
    totalRespect += data.respect;
    totalMoney += data.money;
    
    const avgRespect = data.count > 0 ? Math.round(data.respect / data.count) : 0;
    const avgMoney = data.count > 0 ? Math.round(data.money / data.count) : 0;
    const tier = getCrimeTier(data.name);
    const displayName = tier ? `${data.name} (${tier})` : data.name;
    
    return `
      <tr>
        <td>${displayName}</td>
        <td>${data.count}</td>
        <td>${data.success}/${data.success + data.failed}</td>
        <td>${formatNumber(data.respect)}</td>
        <td>${formatNumber(avgRespect)}</td>
        <td>$${formatNumber(data.money)}</td>
        <td>$${formatNumber(avgMoney)}</td>
      </tr>
    `;
  }).join('');

  // Totals row
  const avgTotalRespect = totalCount > 0 ? Math.round(totalRespect / totalCount) : 0;
  const avgTotalMoney = totalCount > 0 ? Math.round(totalMoney / totalCount) : 0;
  tbody.innerHTML += `
    <tr class="totals-row">
      <td>Total</td>
      <td>${totalCount}</td>
      <td>${totalSuccess}/${totalSuccess + totalFailed}</td>
      <td>${formatNumber(totalRespect)}</td>
      <td>${formatNumber(avgTotalRespect)}</td>
      <td>$${formatNumber(totalMoney)}</td>
      <td>$${formatNumber(avgTotalMoney)}</td>
    </tr>
  `;

  // Update sort indicators
  document.querySelectorAll('#rewardsTable th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === currentSort.column) {
      th.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

function renderRewards() {
  const byCrimeType = new Map();
  const itemCounts = new Map();
  let totalRespect = 0;
  let totalMoney = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let countedCrimes = 0;

  completedCrimes.forEach(crime => {
    const name = crime.name;
    
    if (isMultiStageCrime(name)) return;
    
    if (!byCrimeType.has(name)) {
      byCrimeType.set(name, { name, count: 0, success: 0, failed: 0, respect: 0, money: 0 });
    }
    const entry = byCrimeType.get(name);
    entry.count++;
    countedCrimes++;

    const isSuccess = crime.rewards && crime.rewards.respect > 0;
    if (isSuccess) {
      entry.success++;
      totalSuccess++;
    } else {
      entry.failed++;
      totalFailed++;
    }

    if (crime.rewards) {
      entry.respect += crime.rewards.respect || 0;
      entry.money += crime.rewards.money || 0;
      totalRespect += crime.rewards.respect || 0;
      totalMoney += crime.rewards.money || 0;

      if (crime.rewards.items) {
        crime.rewards.items.forEach(item => {
          const qty = item.quantity || 1;
          const itemId = item.id;
          const itemName = itemNames[itemId] || `Item #${itemId}`;
          itemCounts.set(itemName, (itemCounts.get(itemName) || 0) + qty);
        });
      }
    }
  });

  const totalOCs = totalSuccess + totalFailed;
  const successPct = totalOCs > 0 ? Math.round((totalSuccess / totalOCs) * 100) : 0;
  const factionCut = Math.round(totalMoney * 0.2);

  // Update summary cards
  document.getElementById('totalRespect').textContent = formatNumber(totalRespect);
  document.getElementById('totalMoney').textContent = '$' + formatNumber(totalMoney);
  document.getElementById('factionMoney').textContent = '$' + formatNumber(factionCut);
  document.getElementById('successRate').textContent = successPct + '%';
  document.getElementById('completedCount').textContent = countedCrimes;

  // Store for sorting
  rewardsData = Array.from(byCrimeType.values());
  chartData = rewardsData.map(d => [d.name, d]);

  // Render table
  renderRewardsTable();

  // Render items table
  const itemsSorted = Array.from(itemCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  const itemsTbody = document.getElementById('itemsTableBody');
  if (itemsSorted.length === 0) {
    itemsTbody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text-light);">No items received</td></tr>';
  } else {
    itemsTbody.innerHTML = itemsSorted.map(([name, qty]) => `
      <tr>
        <td>${name}</td>
        <td>${qty}</td>
      </tr>
    `).join('');
  }

  // Render charts
  renderMetricChart(chartData);
  renderTimelineChart();
}

function renderDetails() {
  const container = document.getElementById('detailsCards');
  if (!container) return;

  // Gather stats for ALL crime types including multi-stage
  const byCrimeType = new Map();
  const memberStats = new Map(); // memberId -> { name, byCrime: { crimeName -> { count, success } } }

  completedCrimes.forEach(crime => {
    const name = crime.name;
    
    if (!byCrimeType.has(name)) {
      byCrimeType.set(name, { 
        name, 
        count: 0, 
        success: 0, 
        failed: 0, 
        money: 0,
        isMultiStage: isMultiStageCrime(name)
      });
    }
    const entry = byCrimeType.get(name);
    entry.count++;

    const isSuccess = crime.rewards && crime.rewards.respect > 0;
    if (isSuccess) {
      entry.success++;
    } else {
      entry.failed++;
    }

    if (crime.rewards) {
      entry.money += crime.rewards.money || 0;
    }

    // Track member participation
    crime.slots.forEach(slot => {
      if (slot.user?.id) {
        const memberId = slot.user.id;
        if (!memberStats.has(memberId)) {
          memberStats.set(memberId, {
            id: memberId,
            name: allMembers[memberId]?.name || `Unknown [${memberId}]`,
            byCrime: new Map()
          });
        }
        const member = memberStats.get(memberId);
        if (!member.byCrime.has(name)) {
          member.byCrime.set(name, { count: 0, success: 0 });
        }
        const crimeStats = member.byCrime.get(name);
        crimeStats.count++;
        if (isSuccess) {
          crimeStats.success++;
        }
      }
    });
  });

  // Sort by tier then name
  const sorted = Array.from(byCrimeType.values()).sort((a, b) => {
    const tierA = CRIME_TIERS[a.name.toLowerCase()] || 99;
    const tierB = CRIME_TIERS[b.name.toLowerCase()] || 99;
    if (tierA !== tierB) return tierA - tierB;
    return a.name.localeCompare(b.name);
  });

  container.innerHTML = sorted.map(crime => {
    const tier = getCrimeTier(crime.name);
    const successRate = crime.count > 0 ? Math.round((crime.success / crime.count) * 100) : 0;
    
    // Get top 3 by completions for this crime
    const topByCompletions = Array.from(memberStats.values())
      .filter(m => m.byCrime.has(crime.name))
      .map(m => ({
        id: m.id,
        name: m.name,
        count: m.byCrime.get(crime.name).count,
        success: m.byCrime.get(crime.name).success
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Get top 3 by success rate (min 2 completions to qualify)
    const topBySuccess = Array.from(memberStats.values())
      .filter(m => m.byCrime.has(crime.name) && m.byCrime.get(crime.name).count >= 2)
      .map(m => ({
        id: m.id,
        name: m.name,
        count: m.byCrime.get(crime.name).count,
        success: m.byCrime.get(crime.name).success,
        rate: Math.round((m.byCrime.get(crime.name).success / m.byCrime.get(crime.name).count) * 100)
      }))
      .sort((a, b) => b.rate - a.rate || b.count - a.count)
      .slice(0, 3);

    const multiStageTag = crime.isMultiStage ? '<span class="multi-stage-tag">Multi-Stage</span>' : '';

    return `
      <div class="detail-card">
        <div class="detail-card-header">
          <span class="detail-card-title">${crime.name}</span>
          <span class="detail-card-tier">${tier}</span>
          ${multiStageTag}
        </div>
        <div class="detail-card-stats">
          <div class="detail-stat">
            <span class="detail-stat-value">${crime.count}</span>
            <span class="detail-stat-label">Completed</span>
          </div>
          <div class="detail-stat">
            <span class="detail-stat-value">${successRate}%</span>
            <span class="detail-stat-label">Success Rate</span>
          </div>
          <div class="detail-stat">
            <span class="detail-stat-value">$${formatNumber(crime.money)}</span>
            <span class="detail-stat-label">Money</span>
          </div>
        </div>
        <div class="detail-card-members">
          <div class="detail-member-list">
            <div class="detail-member-title">Top by Completions</div>
            ${topByCompletions.length > 0 ? topByCompletions.map((m, i) => `
              <div class="detail-member-row">
                <span class="detail-member-rank">${i + 1}.</span>
                <a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank" class="detail-member-name">${m.name}</a>
                <span class="detail-member-value">${m.count}</span>
              </div>
            `).join('') : '<div class="detail-member-empty">No data</div>'}
          </div>
          <div class="detail-member-list">
            <div class="detail-member-title">Top by Success Rate</div>
            ${topBySuccess.length > 0 ? topBySuccess.map((m, i) => `
              <div class="detail-member-row">
                <span class="detail-member-rank">${i + 1}.</span>
                <a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank" class="detail-member-name">${m.name}</a>
                <span class="detail-member-value">${m.rate}%</span>
              </div>
            `).join('') : '<div class="detail-member-empty">Min 2 completions required</div>'}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

let metricChartInstance = null;
let timelineChartInstance = null;

function renderMetricChart(data) {
  const ctx = document.getElementById('metricChart').getContext('2d');

  if (metricChartInstance) {
    metricChartInstance.destroy();
  }

  if (data.length === 0) {
    return;
  }

  const isRespect = currentMetric === 'respect';
  const labels = data.map(([name]) => {
    const tier = getCrimeTier(name);
    return tier ? `${name} (${tier})` : name;
  });
  const values = data.map(([, d]) => isRespect ? d.respect : d.money);

  metricChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: 'rgba(34, 197, 94, 0.8)',
        borderColor: 'rgba(34, 197, 94, 1)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          bottom: 20
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.raw;
              return isRespect ? formatNumber(val) + ' respect' : '$' + formatNumber(val);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { 
            color: '#9ca3af',
            font: { size: 9 },
            maxRotation: 60,
            minRotation: 60
          }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.1)' },
          ticks: {
            color: '#9ca3af',
            font: { size: 10 },
            callback: function(value) {
              return isRespect ? formatNumber(value) : '$' + formatNumber(value);
            }
          }
        }
      }
    }
  });
}

function renderTimelineChart() {
  const ctx = document.getElementById('timelineChart').getContext('2d');

  if (timelineChartInstance) {
    timelineChartInstance.destroy();
  }

  if (completedCrimes.length === 0) {
    return;
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const days = [];

  for (let i = 29; i >= 0; i--) {
    const dayStart = new Date(now - (i * dayMs));
    dayStart.setHours(0, 0, 0, 0);
    days.push({
      date: dayStart,
      success: 0,
      failed: 0
    });
  }

  completedCrimes.forEach(crime => {
    if (isMultiStageCrime(crime.name)) return;

    const crimeDate = new Date(crime.executed_at * 1000);
    crimeDate.setHours(0, 0, 0, 0);
    const crimeTime = crimeDate.getTime();

    const dayIndex = days.findIndex(d => d.date.getTime() === crimeTime);

    if (dayIndex !== -1) {
      const isSuccess = crime.rewards && crime.rewards.respect > 0;
      if (isSuccess) {
        days[dayIndex].success++;
      } else {
        days[dayIndex].failed++;
      }
    }
  });

  const labels = days.map(d => `${d.date.getDate()}/${d.date.getMonth() + 1}`);
  const successData = days.map(d => d.success);
  const failedData = days.map(d => d.failed);

  timelineChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Success',
          data: successData,
          backgroundColor: 'rgba(34, 197, 94, 0.8)',
          borderColor: 'rgba(34, 197, 94, 1)',
          borderWidth: 1
        },
        {
          label: 'Failed',
          data: failedData,
          backgroundColor: 'rgba(239, 68, 68, 0.8)',
          borderColor: 'rgba(239, 68, 68, 1)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: '#9ca3af', font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            afterTitle: function(context) {
              const idx = context[0].dataIndex;
              const total = successData[idx] + failedData[idx];
              return total > 0 ? `${successData[idx]}/${total} successful` : '';
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { 
            color: '#9ca3af',
            font: { size: 9 },
            maxRotation: 45,
            minRotation: 45
          }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.1)' },
          ticks: {
            color: '#9ca3af',
            font: { size: 10 },
            stepSize: 1,
            callback: function(value) {
              if (Number.isInteger(value)) return value;
              return null;
            }
          }
        }
      }
    }
  });
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);

  if (days > 0) {
    return `${days}d ago`;
  }
  return `${hours}h ago`;
}

function formatNumber(num) {
  if (num >= 1000000000) {
    return (num / 1000000000).toFixed(1) + 'B';
  }
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

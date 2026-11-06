(function () {
    'use strict';

    var CATS = ['people', 'travel', 'series'];
    var CAT_LABEL = { people: 'People', travel: 'Places', series: 'Series' };
    var NOUN = { people: 'person', travel: 'place', series: 'series' };
    var PASTEL = ['#e9dfd3', '#dde5d8', '#d8e2e9', '#e7dae3', '#efe6d2', '#d6e6e1', '#ebdad5', '#dedceb'];

    /* ══ Utilities ═══════════════════════════════════════════ */

    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
    function slug(s) {
        return String(s || '').toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '');
    }
    function byLabel(a, b) { return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }); }
    function sorted(list) { return (list || []).slice().sort(byLabel); }
    function photoKeyOf(url) {
        try { var p = new URL(url).pathname.split('/').filter(Boolean); return p[0] + '/' + p[1]; } catch (e) { return ''; }
    }
    function fmtDate(iso) {
        return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    var toastTimer;
    function toast(msg, html) {
        var t = $('toast');
        if (html) t.innerHTML = msg; else t.textContent = msg;
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.hidden = true; }, html ? 7000 : 3200);
    }

    function api(method, path, body, rawType) {
        var opts = { method: method, headers: { 'x-fyi-admin': '1' } };
        if (body !== undefined) {
            if (rawType) { opts.body = body; opts.headers['content-type'] = rawType; }
            else { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
        }
        return fetch(path, opts).then(function (r) {
            if (r.status === 401) { showLogin(); throw new Error('Not logged in'); }
            return r;
        });
    }
    function apiJSON(method, path, body, rawType) {
        return api(method, path, body, rawType).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) { var e = new Error(j.error || ('Error ' + r.status)); e.status = r.status; throw e; }
                return j;
            });
        });
    }

    /* ══ App state ═══════════════════════════════════════════ */

    var store = null;            // { rev, config, reviewed, theme }
    var posts = [];              // newest first
    var postById = {};
    var tags = {};               // postId → { photoKey: [tags] }
    var slots = load('admin-slots', []);
    var lastUsed = load('admin-last', {});
    var view = 'new';

    function catOf(tag) {
        if (CATS.indexOf(tag) > -1) return tag;
        for (var i = 0; i < CATS.length; i++) {
            if ((store.config[CATS[i]] || []).some(function (e) { return e.tag === tag; })) return CATS[i];
        }
        return null;
    }
    function labelOf(tag) {
        if (CAT_LABEL[tag]) return CAT_LABEL[tag];
        for (var i = 0; i < CATS.length; i++) {
            var hit = (store.config[CATS[i]] || []).filter(function (e) { return e.tag === tag; })[0];
            if (hit) return hit.label;
        }
        return tag;
    }
    function bumpSlot(tag) {
        lastUsed[tag] = Date.now();
        if (slots.indexOf(tag) === -1) {
            if (slots.length < 9) slots.push(tag);
            else {
                var oldest = 0;
                slots.forEach(function (t, i) { if ((lastUsed[t] || 0) < (lastUsed[slots[oldest]] || 0)) oldest = i; });
                slots[oldest] = tag;
            }
        }
        localStorage.setItem('admin-slots', JSON.stringify(slots));
        localStorage.setItem('admin-last', JSON.stringify(lastUsed));
    }

    /* ══ Boot / login ════════════════════════════════════════ */

    function showLogin() {
        $('app').hidden = true;
        $('login').hidden = false;
    }

    function boot() {
        fetch('/api/me', { headers: { 'x-fyi-admin': '1' } }).then(function (r) {
            if (r.status === 401) { showLogin(); return null; }
            return r.json();
        }).then(function (me) {
            if (!me) return;
            $('app').hidden = false;
            return apiJSON('GET', '/api/store').then(function (s) {
                setStore(s);
                initTagView();
                initNewView();
                initListsView();
                initAnalyticsView();
                setView(location.hash.replace('#', '') || 'new');
                loadPosts();
            });
        }).catch(function (e) { toast(e.message); });
    }

    $('btn-logout').addEventListener('click', function () {
        api('POST', '/api/auth/logout', {}).finally(function () { location.reload(); });
    });

    function setView(v) {
        if (v === 'lists') v = 'places';
        var routes = {
            new: 'New post',
            tag: 'Photo library',
            analytics: 'Analytics',
            people: 'People',
            places: 'Places',
            series: 'Series',
        };
        if (!routes[v]) v = 'new';
        view = ['people', 'places', 'series'].indexOf(v) > -1 ? 'lists' : v;
        document.querySelectorAll('.tab').forEach(function (t) {
            var active = t.getAttribute('data-route') === v;
            t.classList.toggle('is-active', active);
            if (active) t.setAttribute('aria-current', 'page');
            else t.removeAttribute('aria-current');
        });
        document.querySelectorAll('.view').forEach(function (s) { s.classList.toggle('is-active', s.getAttribute('data-view') === view); });
        document.querySelectorAll('[data-category]').forEach(function (s) {
            s.hidden = s.getAttribute('data-category') !== (v === 'places' ? 'travel' : v);
        });
        $('view-title').textContent = routes[v];
        history.replaceState(null, '', '#' + v);
        if (view === 'lists') renderLists();
        if (view === 'analytics') loadAnalytics();
    }
    window.addEventListener('hashchange', function () {
        if (store) setView(location.hash.slice(1));
    });

    /* ══ Store (lists, reviewed flags, theme) ════════════════ */

    function setStore(s) {
        store = s;
        slots = slots.filter(function (t) { return !!catOf(t); });
        paintBanner();
    }

    function onListsChanged() {
        chipPanels.forEach(function (p) { p.render(); });
        renderTagFilter();
        if (view === 'lists') renderLists();
        repaintAllTiles();
    }

    // Store writes go one at a time so they never race each other.
    var storeQueue = Promise.resolve();
    function queued(fn) {
        var run = storeQueue.then(fn, fn);
        storeQueue = run.catch(function () {});
        return run;
    }

    // Replace the lists. Rejected (409) if another tab changed them first.
    function saveConfig(config) {
        return queued(function () { return apiJSON('PUT', '/api/store', { baseRev: store.rev, config: config }); })
            .then(function (s) { setStore(s); onListsChanged(); return s; })
            .catch(function (e) {
                if (e.status === 409) {
                    toast('Lists changed in another tab — reloaded. Please try again.');
                    return apiJSON('GET', '/api/store').then(function (s) { setStore(s); onListsChanged(); throw e; });
                }
                toast(e.message);
                throw e;
            });
    }
    function cloneConfig() { return JSON.parse(JSON.stringify(store.config)); }

    function addEntry(cat, label) {
        label = String(label || '').trim();
        var tag = slug(label);
        if (!tag) return Promise.reject(new Error('Type a name'));
        if (catOf(tag)) { toast('"' + tag + '" already exists in ' + CAT_LABEL[catOf(tag)]); return Promise.reject(new Error('exists')); }
        var cfg = cloneConfig();
        cfg[cat].push(cat === 'people' ? { tag: tag, label: label } : { tag: tag, label: label, cover: '' });
        return saveConfig(cfg).then(function () { toast('Added ' + label); return tag; });
    }

    var reviewedPending = {}, reviewedTimer = null;
    function setReviewed(pid, on) {
        if (on) store.reviewed[pid] = true; else delete store.reviewed[pid];
        reviewedPending[pid] = !!on;
        clearTimeout(reviewedTimer);
        reviewedTimer = setTimeout(function () {
            var batch = reviewedPending;
            reviewedPending = {};
            queued(function () { return apiJSON('PATCH', '/api/store', { reviewed: batch }); }).then(function (s) {
                if (s.rev !== store.rev) { setStore(s); onListsChanged(); return; }
                store.theme = s.theme;
            }).catch(function (e) { toast('Couldn’t save reviewed marks: ' + e.message); });
        }, 700);
    }

    function paintBanner() {
        var stale = store && store.theme && !store.theme.upToDate;
        $('theme-banner').hidden = !stale;
    }
    function fetchTheme() {
        return api('GET', '/api/theme').then(function (r) {
            if (!r.ok) throw new Error('Theme download failed (' + r.status + ')');
            var hash = r.headers.get('x-theme-hash');
            return r.text().then(function (text) { return { text: text, hash: hash }; });
        });
    }
    function markThemeCopied(hash) {
        return queued(function () { return apiJSON('POST', '/api/theme', { hash: hash }); }).then(function (j) {
            store.theme = j.theme;
            paintBanner();
            toast('Now in Tumblr: Edit appearance → Edit theme → Edit HTML → ⌘A → ⌘V → Update preview → Save', false);
        });
    }
    $('btn-copy-theme').addEventListener('click', function () {
        var button = this;
        button.disabled = true;
        fetchTheme().then(function (theme) {
            return navigator.clipboard.writeText(theme.text).then(function () { return markThemeCopied(theme.hash); });
        }).catch(function (e) { toast('Couldn’t copy the theme: ' + e.message); })
            .finally(function () { button.disabled = false; });
    });

    /* ══ Analytics ══════════════════════════════════════════ */

    var analyticsDays = 7, analyticsPending = null, analyticsCache = {};

    function initAnalyticsView() {
        document.querySelector('.periods').addEventListener('click', function (e) {
            var button = e.target.closest('[data-days]');
            if (!button) return;
            analyticsDays = +button.getAttribute('data-days');
            document.querySelectorAll('.periods button').forEach(function (b) {
                b.classList.toggle('is-active', b === button);
            });
            loadAnalytics(true);
        });
    }

    function loadAnalytics(refresh) {
        if (view !== 'analytics') return;
        if (!refresh && analyticsCache[analyticsDays]) {
            renderAnalytics(analyticsCache[analyticsDays]);
            return;
        }
        if (analyticsPending) return;
        $('analytics-status').textContent = 'Loading…';
        analyticsPending = apiJSON('GET', '/api/analytics?days=' + analyticsDays)
            .then(function (data) {
                analyticsCache[analyticsDays] = data;
                renderAnalytics(data);
            })
            .catch(function (e) {
                $('analytics-status').textContent = 'Couldn’t load analytics';
                toast(e.message);
            })
            .finally(function () {
                analyticsPending = null;
                if (view === 'analytics' && !analyticsCache[analyticsDays]) loadAnalytics();
            });
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString();
    }

    function pageName(path) {
        if (path === '/') return 'Everything';
        var tagged = path.match(/^\/tagged\/([^/]+)/);
        if (tagged) return tagged[1].replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        if (path === '/info') return 'Info';
        return path;
    }

    function countryName(code) {
        if (code === 'ZZ') return 'Unknown';
        try {
            return new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }).of(code);
        } catch (e) {
            return code;
        }
    }

    function renderRanked(id, rows, label) {
        var list = $(id);
        list.textContent = '';
        if (!rows.length) {
            var empty = el('li', 'ranked-list__empty', 'No data yet');
            list.appendChild(empty);
            return;
        }
        var max = rows[0].count || 1;
        rows.forEach(function (row) {
            var item = el('li');
            var name = label(row.name);
            item.appendChild(el('span', 'ranked-list__name', name));
            item.appendChild(el('span', 'ranked-list__count', formatNumber(row.count)));
            var bar = el('span', 'ranked-list__bar');
            bar.style.setProperty('--value', (row.count / max * 100) + '%');
            item.appendChild(bar);
            list.appendChild(item);
        });
    }

    function svgEl(name, attrs) {
        var node = document.createElementNS('http://www.w3.org/2000/svg', name);
        Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
        return node;
    }

    function renderChart(rows) {
        var box = $('traffic-chart');
        box.textContent = '';
        var width = 760, height = 240, left = 36, right = 12, top = 16, bottom = 34;
        var innerW = width - left - right, innerH = height - top - bottom;
        var max = Math.max(1, ...rows.map(function (row) { return row.pageviews; }));
        var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': 'Pageviews and estimated visitors' });
        [0, .5, 1].forEach(function (part) {
            var y = top + innerH * part;
            svg.appendChild(svgEl('line', { x1: left, y1: y, x2: width - right, y2: y, class: 'chart__grid' }));
            var text = svgEl('text', { x: left - 8, y: y + 4, class: 'chart__axis', 'text-anchor': 'end' });
            text.textContent = Math.round(max * (1 - part));
            svg.appendChild(text);
        });
        function points(key) {
            return rows.map(function (row, i) {
                var x = rows.length === 1 ? left + innerW / 2 : left + innerW * i / (rows.length - 1);
                var y = top + innerH - innerH * row[key] / max;
                return x + ',' + y;
            }).join(' ');
        }
        if (rows.length) {
            svg.appendChild(svgEl('polyline', { points: points('pageviews'), class: 'chart__line chart__line--views' }));
            svg.appendChild(svgEl('polyline', { points: points('visitors'), class: 'chart__line chart__line--visitors' }));
        }
        var step = rows.length > 10 ? Math.ceil(rows.length / 6) : 1;
        rows.forEach(function (row, i) {
            if (i % step && i !== rows.length - 1) return;
            var x = rows.length === 1 ? left + innerW / 2 : left + innerW * i / (rows.length - 1);
            var text = svgEl('text', { x: x, y: height - 8, class: 'chart__axis', 'text-anchor': 'middle' });
            var date = new Date(row.key + 'T12:00:00Z');
            text.textContent = row.label || date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
            svg.appendChild(text);
        });
        box.appendChild(svg);
    }

    function renderAnalytics(data) {
        $('metric-visitors').textContent = formatNumber(data.totals.visitors);
        $('metric-pageviews').textContent = formatNumber(data.totals.pageviews);
        $('metric-average').textContent = formatNumber(data.totals.dailyAverage);
        $('analytics-status').textContent = data.totals.pageviews ? '' : 'Analytics starts after the updated theme is installed.';
        renderChart(data.chart);
        renderRanked('analytics-referrals', data.referrals, function (name) { return name; });
        renderRanked('analytics-countries', data.countries, countryName);
        renderRanked('analytics-pages', data.pages, pageName);
    }

    /* ══ Chip panel (shared by Tag and New post) ═════════════ */

    var chipPanels = [];

    // opts: stateOf(tag) → 'all' | 'some' | '', enabled() → bool, onToggle(tag)
    function ChipPanel(box, opts) {
        this.box = box;
        this.opts = opts;
        this.query = '';
        var self = this;
        box.addEventListener('click', function (e) {
            var chip = e.target.closest('.chip');
            if (chip) { opts.onToggle(chip.getAttribute('data-tag')); return; }
            var add = e.target.closest('.group__add');
            if (add) self.showAdd(add.getAttribute('data-cat'));
        });
        chipPanels.push(this);
        this.render();
    }
    ChipPanel.prototype.render = function () {
        var box = this.box, self = this;
        var open = Array.from(box.querySelectorAll('details[open]')).map(function (g) { return g.getAttribute('data-cat'); });
        box.textContent = '';
        var search = el('input', 'tag-search');
        search.type = 'search';
        search.placeholder = 'Find a tag…';
        search.setAttribute('aria-label', 'Find a tag');
        search.value = this.query;
        search.addEventListener('input', function () { self.query = search.value; self.filter(); });
        box.appendChild(search);
        CATS.forEach(function (cat) {
            var g = el('details', 'group');
            g.setAttribute('data-cat', cat);
            g.open = open.indexOf(cat) > -1;
            var head = el('summary', 'group__head');
            head.appendChild(el('span', 'group__title', CAT_LABEL[cat]));
            head.appendChild(el('span', 'muted small', String(store.config[cat].length)));
            g.appendChild(head);
            var add = el('button', 'group__add', '+ Add');
            add.type = 'button';
            add.setAttribute('data-cat', cat);
            g.appendChild(add);
            var chips = el('div', 'chips');
            var any = el('button', 'chip chip--cat', cat === 'people' ? 'Someone else' : 'Other ' + cat);
            any.type = 'button';
            any.setAttribute('data-tag', cat);
            chips.appendChild(any);
            sorted(store.config[cat]).forEach(function (e) {
                var c = el('button', 'chip', e.label);
                c.type = 'button';
                c.setAttribute('data-tag', e.tag);
                chips.appendChild(c);
            });
            g.appendChild(chips);
            box.appendChild(g);
        });
        this.filter();
        this.paint();
    };
    ChipPanel.prototype.filter = function () {
        var query = this.query.trim().toLowerCase();
        this.box.querySelectorAll('.group').forEach(function (g) {
            var matches = 0;
            g.querySelectorAll('.chip').forEach(function (c) {
                c.hidden = !!query && c.textContent.toLowerCase().indexOf(query) === -1;
                if (!c.hidden) matches++;
            });
            g.hidden = !matches;
            if (query && matches) g.open = true;
        });
    };
    ChipPanel.prototype.paint = function () {
        var opts = this.opts, on = opts.enabled();
        this.box.querySelectorAll('.chip').forEach(function (c) {
            var tag = c.getAttribute('data-tag');
            var st = on ? opts.stateOf(tag) : '';
            c.classList.toggle('is-all', st === 'all');
            c.classList.toggle('is-some', st === 'some');
            c.disabled = !on;
            var old = c.querySelector('.chip__key');
            if (old) old.remove();
            var i = slots.indexOf(tag);
            if (i > -1) c.appendChild(el('span', 'chip__key', String(i + 1)));
        });
    };
    ChipPanel.prototype.showAdd = function (cat) {
        var self = this;
        var group = this.box.querySelector('.group[data-cat="' + cat + '"]');
        if (group.querySelector('.add-form')) { group.querySelector('.add-form input').focus(); return; }
        var form = el('form', 'add-form');
        var input = el('input');
        input.placeholder = 'New ' + NOUN[cat] + ' name';
        var ok = el('button', null, 'Add'); ok.type = 'submit';
        var cancel = el('button', null, 'Cancel'); cancel.type = 'button';
        form.appendChild(input); form.appendChild(ok); form.appendChild(cancel);
        group.querySelector('.group__head').after(form);
        input.focus();
        cancel.addEventListener('click', function () { form.remove(); });
        input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); form.remove(); } });
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            addEntry(cat, input.value).then(function (tag) {
                if (self.opts.enabled()) self.opts.onToggle(tag);
            }).catch(function () {});
        });
    };

    /* ══ Tag view ════════════════════════════════════════════ */

    var sheet = $('sheet');
    var sel = new Set();          // "postId|photoKey"
    var anchor = null, currentPost = null;
    var order = [];
    var tileEls = new Map(), postEls = new Map();
    var undoStack = [];
    var tagPanel;
    var saved = {};               // postId → JSON of last saved tags
    var status = {};              // postId → 'saving' | 'saved' | 'error'
    var timers = {}, inflight = {}, again = {}, retries = {};
    var loadingDone = false;

    function split(id) { var i = id.indexOf('|'); return [id.slice(0, i), id.slice(i + 1)]; }
    function tagsOf(pid, key) { return (tags[pid] && tags[pid][key]) || []; }
    function setTags(pid, key, list) {
        tags[pid] = tags[pid] || {};
        tags[pid][key] = list.slice().sort();
    }

    function initTagView() {
        tagPanel = new ChipPanel($('tag-groups'), {
            enabled: function () { return sel.size > 0; },
            stateOf: function (tag) {
                var items = Array.from(sel).map(split);
                var n = items.filter(function (pk) { return tagsOf(pk[0], pk[1]).indexOf(tag) > -1; }).length;
                return n === 0 ? '' : n === items.length ? 'all' : 'some';
            },
            onToggle: toggleTag,
        });
        renderTagFilter();
        ['f-status', 'f-tag', 'f-year'].forEach(function (id) { $(id).addEventListener('change', applyFilters); });
        $('btn-select-post').addEventListener('click', function () { selectPost(currentPost); });
        $('btn-clear-tags').addEventListener('click', clearTags);
        $('btn-undo').addEventListener('click', undo);
    }

    function loadPosts() {
        posts = []; postById = {}; tags = {}; saved = {};
        tileEls.clear(); postEls.clear(); sel.clear();
        sheet.textContent = '';
        loadingDone = false;
        var pages = {}, next = 0, total = null;
        function add(offset) {
            return apiJSON('GET', '/api/posts?offset=' + offset).then(function (r) {
                total = r.total;
                pages[offset] = r.posts;
                while (pages[next]) {
                    pages[next].forEach(addPost);
                    delete pages[next];
                    next += 20;
                }
                applyFilters();
                paintProgress();
            });
        }
        add(0).then(function () {
            var offsets = [];
            for (var o = 20; o < total; o += 20) offsets.push(o);
            function worker() {
                var o = offsets.shift();
                if (o == null) return Promise.resolve();
                return add(o).catch(function (e) { offsets.push(o); toast('Retrying: ' + e.message); return new Promise(function (r) { setTimeout(r, 2000); }); }).then(worker);
            }
            return Promise.all([worker(), worker(), worker()]);
        }).then(function () {
            loadingDone = true;
            renderYearFilter();
            paintProgress();
            if (!currentPost && posts.length) setCurrent(posts[0].id);
            if (view === 'lists') renderLists();
        }).catch(function (e) { toast('Couldn’t load posts: ' + e.message); });
    }

    function addPost(p) {
        if (postById[p.id]) return;
        posts.push(p);
        postById[p.id] = p;
        tags[p.id] = {};
        p.photos.forEach(function (ph) { tags[p.id][ph.key] = ph.tags.slice().sort(); });
        saved[p.id] = JSON.stringify(tags[p.id]);
        sheet.appendChild(renderPost(p));
        if (!currentPost) setCurrent(p.id);
    }

    function renderPost(p) {
        var sec = el('section', 'post');
        sec.setAttribute('data-id', p.id);
        var head = el('div', 'post__head');
        head.appendChild(el('span', 'dot'));
        head.appendChild(el('span', 'post__date', fmtDate(p.date)));
        var link = el('a', 'post__link', 'open ↗');
        link.href = p.url; link.target = '_blank'; link.rel = 'noopener';
        head.appendChild(link);
        if (!p.npf) head.appendChild(el('span', 'post__legacy', 'Old-format post — edit tags on tumblr.com'));
        head.appendChild(el('span', 'post__count'));
        if (p.npf && p.photos.length) {
            var selBtn = el('button', 'post__btn js-select-post', 'Select all');
            selBtn.type = 'button';
            head.appendChild(selBtn);
        }
        var revBtn = el('button', 'post__btn js-review', 'Reviewed');
        revBtn.type = 'button';
        head.appendChild(revBtn);
        sec.appendChild(head);

        var wrap = el('div', 'photos');
        if (p.npf) p.photos.forEach(function (ph) {
            var id = p.id + '|' + ph.key;
            var t = el('div', 'photo');
            t.setAttribute('data-id', id);
            t.style.width = Math.round(150 * (ph.w && ph.h ? ph.w / ph.h : 1.5)) + 'px';
            var img = el('img');
            img.loading = 'lazy'; img.decoding = 'async'; img.alt = ''; img.src = ph.thumb;
            t.appendChild(img);
            t.appendChild(el('div', 'photo__tags'));
            wrap.appendChild(t);
            tileEls.set(id, t);
            paintTile(id);
        });
        sec.appendChild(wrap);
        postEls.set(p.id, sec);
        paintPost(p.id, sec);
        return sec;
    }

    function paintTile(id) {
        var t = tileEls.get(id);
        if (!t) return;
        var pk = split(id);
        t.classList.toggle('is-selected', sel.has(id));
        var box = t.lastChild;
        box.textContent = '';
        tagsOf(pk[0], pk[1]).forEach(function (tag) {
            box.appendChild(el('span', 'photo__tag photo__tag--' + (catOf(tag) || 'other'), labelOf(tag)));
        });
    }
    function repaintAllTiles() { tileEls.forEach(function (_, id) { paintTile(id); }); }

    function paintPost(pid, secEl) {
        var sec = secEl || postEls.get(pid);
        var p = postById[pid];
        if (!sec || !p) return;
        var m = tags[pid] || {};
        var tagged = p.photos.filter(function (ph) { return (m[ph.key] || []).length; }).length;
        sec.querySelector('.post__count').textContent = p.npf ? tagged + ' / ' + p.photos.length + ' tagged' : '';
        var rv = !!store.reviewed[pid];
        sec.classList.toggle('is-reviewed', rv);
        var btn = sec.querySelector('.js-review');
        btn.classList.toggle('is-on', rv);
        btn.textContent = rv ? '✓ Reviewed' : 'Reviewed';
        sec.classList.toggle('is-current', pid === currentPost);
        var dot = sec.querySelector('.dot');
        dot.className = 'dot' + (status[pid] ? ' is-' + status[pid] : '');
        dot.title = status[pid] === 'error' ? 'Not saved — retrying' : status[pid] === 'saving' ? 'Saving…' : status[pid] === 'saved' ? 'Saved to Tumblr' : '';
    }

    function paintProgress() {
        var total = 0, tagged = 0;
        posts.forEach(function (p) {
            var m = tags[p.id] || {};
            total += p.photos.length;
            p.photos.forEach(function (ph) { if ((m[ph.key] || []).length) tagged++; });
        });
        var done = posts.filter(function (p) { return store.reviewed[p.id]; }).length;
        $('progress-fill').style.width = (posts.length ? 100 * done / posts.length : 0) + '%';
        $('progress-text').textContent = (loadingDone ? '' : 'Loading… ') + done + ' / ' + posts.length + ' posts reviewed · ' + tagged + ' / ' + total + ' photos tagged';
    }

    function renderTagFilter() {
        var s = $('f-tag'), v = s.value;
        s.textContent = '';
        s.appendChild(new Option('Any', ''));
        CATS.forEach(function (cat) {
            var og = document.createElement('optgroup');
            og.label = CAT_LABEL[cat];
            og.appendChild(new Option('All ' + cat, cat));
            sorted(store.config[cat]).forEach(function (e) { og.appendChild(new Option(e.label, e.tag)); });
            s.appendChild(og);
        });
        s.value = v;
    }
    function renderYearFilter() {
        var s = $('f-year'), v = s.value;
        s.textContent = '';
        s.appendChild(new Option('All', ''));
        Array.from(new Set(posts.map(function (p) { return p.date.slice(0, 4); }))).sort().reverse()
            .forEach(function (y) { s.appendChild(new Option(y, y)); });
        s.value = v;
    }

    function postMatches(p) {
        var st = $('f-status').value, tag = $('f-tag').value, year = $('f-year').value;
        if (year && p.date.slice(0, 4) !== year) return false;
        if (st === 'reviewed' && !store.reviewed[p.id]) return false;
        if (st === 'unreviewed' && store.reviewed[p.id]) return false;
        if (st === 'untagged') {
            var m = tags[p.id] || {};
            if (!p.photos.some(function (ph) { return !(m[ph.key] || []).length; })) return false;
        }
        if (tag) {
            var all = new Set();
            Object.values(tags[p.id] || {}).forEach(function (l) { l.forEach(function (t) { all.add(t); }); });
            if (!Array.from(all).some(function (t) { return t === tag || (CATS.indexOf(tag) > -1 && catOf(t) === tag); })) return false;
        }
        return true;
    }
    function applyFilters() {
        order = [];
        posts.forEach(function (p) {
            var show = postMatches(p);
            postEls.get(p.id).hidden = !show;
            if (show && p.npf) p.photos.forEach(function (ph) { order.push(p.id + '|' + ph.key); });
        });
        var visible = new Set(order);
        Array.from(sel).forEach(function (id) { if (!visible.has(id)) { sel.delete(id); paintTile(id); } });
        paintSel();
    }

    function paintSel() {
        tagPanel.paint();
        $('tag-sel-count').textContent = sel.size ? sel.size + ' photo' + (sel.size === 1 ? '' : 's') + ' selected' : 'Nothing selected';
    }
    function setSelection(ids, keep) {
        var before = new Set(sel);
        if (!keep) sel.clear();
        ids.forEach(function (id) { sel.add(id); });
        before.forEach(function (id) { if (!sel.has(id)) paintTile(id); });
        sel.forEach(function (id) { if (!before.has(id)) paintTile(id); });
        paintSel();
    }
    function clearSelection() { setSelection([], false); anchor = null; }
    function clickTile(id, e) {
        if (e.shiftKey && anchor && order.indexOf(anchor) > -1) {
            var a = order.indexOf(anchor), b = order.indexOf(id);
            setSelection(order.slice(Math.min(a, b), Math.max(a, b) + 1), e.metaKey || e.ctrlKey);
        } else if (e.metaKey || e.ctrlKey) {
            if (sel.has(id)) { sel.delete(id); paintTile(id); paintSel(); } else setSelection([id], true);
            anchor = id;
        } else {
            setSelection([id], false);
            anchor = id;
        }
        setCurrent(split(id)[0]);
    }
    function selectPost(pid) {
        var p = postById[pid];
        if (!p || !p.npf || !p.photos.length) return;
        setSelection(p.photos.map(function (ph) { return pid + '|' + ph.key; }), false);
        anchor = pid + '|' + p.photos[0].key;
        setCurrent(pid);
    }

    // Box selection
    var lasso = $('lasso'), drag = null;
    sheet.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        var tile = e.target.closest('.photo');
        if (tile) { e.preventDefault(); clickTile(tile.getAttribute('data-id'), e); return; }
        if (e.target.closest('button, a')) return;
        e.preventDefault();
        drag = { x: e.clientX, y: e.clientY, keep: e.shiftKey || e.metaKey || e.ctrlKey, base: new Set(sel), moved: false };
    });
    window.addEventListener('mousemove', function (e) {
        if (!drag) return;
        var x1 = Math.min(drag.x, e.clientX), x2 = Math.max(drag.x, e.clientX);
        var y1 = Math.min(drag.y, e.clientY), y2 = Math.max(drag.y, e.clientY);
        if (!drag.moved && x2 - x1 < 4 && y2 - y1 < 4) return;
        drag.moved = true;
        lasso.hidden = false;
        lasso.style.left = x1 + 'px'; lasso.style.top = y1 + 'px';
        lasso.style.width = (x2 - x1) + 'px'; lasso.style.height = (y2 - y1) + 'px';
        var hits = drag.keep ? Array.from(drag.base) : [];
        postEls.forEach(function (sec) {
            if (sec.hidden) return;
            var r = sec.getBoundingClientRect();
            if (r.bottom < y1 || r.top > y2) return;
            sec.querySelectorAll('.photo').forEach(function (t) {
                var b = t.getBoundingClientRect();
                if (b.right >= x1 && b.left <= x2 && b.bottom >= y1 && b.top <= y2) hits.push(t.getAttribute('data-id'));
            });
        });
        setSelection(hits, false);
    });
    window.addEventListener('mouseup', function () {
        if (!drag) return;
        if (!drag.moved && !drag.keep) clearSelection();
        else if (sel.size) { anchor = Array.from(sel)[0]; setCurrent(split(anchor)[0]); }
        drag = null;
        lasso.hidden = true;
    });
    sheet.addEventListener('click', function (e) {
        var sec = e.target.closest('.post');
        if (!sec) return;
        var pid = sec.getAttribute('data-id');
        if (e.target.closest('.js-select-post')) selectPost(pid);
        if (e.target.closest('.js-review')) toggleReviewed(pid, false);
    });

    function setCurrent(pid) {
        if (pid === currentPost) return;
        var prev = currentPost;
        currentPost = pid;
        if (prev) paintPost(prev);
        if (pid) paintPost(pid);
    }
    function visiblePosts() { return posts.filter(function (p) { return !postEls.get(p.id).hidden; }); }
    var navLock = 0;
    function goTo(pid) {
        navLock = Date.now();
        setCurrent(pid);
        postEls.get(pid).scrollIntoView({ block: 'start' });
    }
    function step(d) {
        var v = visiblePosts();
        var i = v.findIndex(function (p) { return p.id === currentPost; });
        var n = v[Math.max(0, Math.min(v.length - 1, i + d))];
        if (n) { clearSelection(); goTo(n.id); }
    }
    function nextUnreviewed() {
        var v = visiblePosts();
        var i = v.findIndex(function (p) { return p.id === currentPost; });
        var n = v.slice(i + 1).concat(v.slice(0, i + 1)).filter(function (p) { return !store.reviewed[p.id]; })[0];
        if (n) { clearSelection(); goTo(n.id); } else toast('Every visible post is reviewed 🎉');
    }
    sheet.addEventListener('scroll', function () {
        if (sel.size || Date.now() - navLock < 500) return;
        var top = sheet.getBoundingClientRect().top + 60;
        var v = visiblePosts();
        for (var i = 0; i < v.length; i++) {
            if (postEls.get(v[i].id).getBoundingClientRect().bottom > top) { setCurrent(v[i].id); break; }
        }
    }, { passive: true });

    // Editing
    function snapshot(ids) {
        undoStack.push(ids.map(function (id) { var pk = split(id); return [pk[0], pk[1], tagsOf(pk[0], pk[1]).slice()]; }));
        if (undoStack.length > 200) undoStack.shift();
    }
    function afterEdit(ids) {
        var pids = new Set();
        ids.forEach(function (id) { paintTile(id); pids.add(split(id)[0]); });
        pids.forEach(function (pid) { markDirty(pid); paintPost(pid); });
        paintSel();
        paintProgress();
    }
    function toggleTag(tag) {
        if (!sel.size) { toast('Select photos first'); return; }
        var ids = Array.from(sel);
        var all = ids.every(function (id) { var pk = split(id); return tagsOf(pk[0], pk[1]).indexOf(tag) > -1; });
        snapshot(ids);
        ids.forEach(function (id) {
            var pk = split(id);
            var t = tagsOf(pk[0], pk[1]).filter(function (x) { return x !== tag; });
            if (!all) t.push(tag);
            setTags(pk[0], pk[1], t);
        });
        bumpSlot(tag);
        afterEdit(ids);
    }
    function clearTags() {
        if (!sel.size) return;
        var ids = Array.from(sel);
        snapshot(ids);
        ids.forEach(function (id) { var pk = split(id); setTags(pk[0], pk[1], []); });
        afterEdit(ids);
    }
    function undo() {
        var snap = undoStack.pop();
        if (!snap) { toast('Nothing to undo'); return; }
        snap.forEach(function (s) { setTags(s[0], s[1], s[2]); });
        afterEdit(snap.map(function (s) { return s[0] + '|' + s[1]; }));
    }
    function toggleReviewed(pid, advance) {
        if (!pid) return;
        var on = !store.reviewed[pid];
        setReviewed(pid, on);
        paintPost(pid);
        paintProgress();
        if (advance && on) nextUnreviewed();
    }

    // Saving tags straight to Tumblr (one post at a time, two in flight).
    var running = 0, waiting = [];
    function slot(fn) {
        return new Promise(function (resolve, reject) {
            function go() {
                running++;
                fn().then(resolve, reject).finally(function () { running--; var n = waiting.shift(); if (n) n(); });
            }
            if (running < 2) go(); else waiting.push(go);
        });
    }
    function setStatus(pid, s) { status[pid] = s; paintPost(pid); paintSaveStatus(); }
    function markDirty(pid) {
        setStatus(pid, 'saving');
        clearTimeout(timers[pid]);
        timers[pid] = setTimeout(function () { flush(pid); }, 1200);
    }
    function flush(pid) {
        if (inflight[pid]) { again[pid] = true; return; }
        var body = JSON.parse(JSON.stringify(tags[pid] || {}));
        var sig = JSON.stringify(body);
        if (sig === saved[pid]) { setStatus(pid, 'saved'); return; }
        inflight[pid] = true;
        slot(function () { return apiJSON('PUT', '/api/post?id=' + pid, { photos: body }); })
            .then(function (r) {
                saved[pid] = sig;
                retries[pid] = 0;
                postById[pid].tags = r.post.tags;
                setStatus(pid, 'saved');
            })
            .catch(function (e) {
                setStatus(pid, 'error');
                retries[pid] = (retries[pid] || 0) + 1;
                if (retries[pid] <= 5 && e.status !== 422 && e.status !== 400) {
                    setTimeout(function () { flush(pid); }, 3000 * retries[pid]);
                } else toast('Couldn’t save a post: ' + e.message);
            })
            .finally(function () {
                inflight[pid] = false;
                if (again[pid]) { again[pid] = false; flush(pid); }
            });
    }
    function paintSaveStatus() {
        var s = Object.values(status);
        var saving = s.filter(function (x) { return x === 'saving'; }).length;
        var err = s.filter(function (x) { return x === 'error'; }).length;
        $('save-status').textContent = err ? '⚠ ' + err + ' post' + (err === 1 ? '' : 's') + ' not saved — retrying'
            : saving ? 'Saving ' + saving + ' to Tumblr…' : s.length ? 'All changes saved to Tumblr' : '';
        $('save-status').style.color = err ? '#c00' : '';
    }
    window.addEventListener('beforeunload', function (e) {
        var busy = Object.values(status).some(function (x) { return x !== 'saved'; }) || newItems.length;
        if (busy) { e.preventDefault(); e.returnValue = ''; }
    });

    function tagKeys(e, k) {
        if (k === 'escape') clearSelection();
        else if (k === 'a') selectPost(currentPost);
        else if (k === 'r') toggleReviewed(currentPost, true);
        else if (k === 'j') step(1);
        else if (k === 'k') step(-1);
        else if (k === 'u') nextUnreviewed();
        else if (k === 'backspace' || k === 'delete') clearTags();
        else if (/^[1-9]$/.test(k)) { if (slots[+k - 1]) toggleTag(slots[+k - 1]); }
        else return false;
        return true;
    }

    /* ══ New post view ═══════════════════════════════════════ */

    var newItems = [];            // { id, name, status, error, thumb, w, h, url, tags }
    var newSel = new Set(), newAnchor = null, newPanel, nextItemId = 1;
    var grid = $('new-grid');
    var MAX_W = 2048, MAX_H = 3072, MAX_BYTES = 4.3 * 1024 * 1024;

    function initNewView() {
        newPanel = new ChipPanel($('new-groups'), {
            enabled: function () { return newSel.size > 0; },
            stateOf: function (tag) {
                var items = selectedItems();
                var n = items.filter(function (it) { return it.tags.indexOf(tag) > -1; }).length;
                return n === 0 ? '' : n === items.length ? 'all' : 'some';
            },
            onToggle: function (tag) {
                var items = selectedItems();
                if (!items.length) { toast('Select photos first'); return; }
                var all = items.every(function (it) { return it.tags.indexOf(tag) > -1; });
                items.forEach(function (it) {
                    it.tags = it.tags.filter(function (t) { return t !== tag; });
                    if (!all) it.tags.push(tag);
                    it.tags.sort();
                });
                bumpSlot(tag);
                renderNew();
            },
        });
        var drop = $('drop'), input = $('file-input');
        $('btn-create-post').addEventListener('click', function () { input.click(); });
        input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
        ['dragenter', 'dragover'].forEach(function (t) {
            drop.addEventListener(t, function (e) {
                if (!e.dataTransfer || Array.from(e.dataTransfer.types).indexOf('Files') === -1) return;
                e.preventDefault(); drop.classList.add('is-over');
            });
        });
        ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('is-over'); }); });
        drop.addEventListener('drop', function (e) {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            addFiles(e.dataTransfer.files);
        });
        $('btn-new-select-all').addEventListener('click', function () { newSel = new Set(newItems.map(function (i) { return i.id; })); renderNew(); });
        $('btn-new-clear').addEventListener('click', function () { selectedItems().forEach(function (it) { it.tags = []; }); renderNew(); });
        $('post-state').addEventListener('change', paintPublish);
        $('btn-publish').addEventListener('click', publish);
        paintPublish();
    }

    function selectedItems() { return newItems.filter(function (it) { return newSel.has(it.id); }); }

    function addFiles(files) {
        Array.from(files).forEach(function (file) {
            var it = { id: nextItemId++, name: file.name, status: 'resizing', tags: [], file: file };
            newItems.push(it);
            prepare(it);
        });
        renderNew();
    }

    function resize(file) {
        return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
            var scale = Math.min(1, MAX_W / bmp.width, MAX_H / bmp.height);
            var w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
            var canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
            bmp.close && bmp.close();
            function encode(q) {
                return new Promise(function (res) { canvas.toBlob(res, 'image/jpeg', q); }).then(function (b) {
                    return b.size > MAX_BYTES && q > 0.6 ? encode(q - 0.08) : b;
                });
            }
            return encode(0.92).then(function (blob) { return { blob: blob, w: w, h: h }; });
        });
    }

    var uploading = 0, uploadQueue = [];
    function prepare(it) {
        resize(it.file).then(function (r) {
            it.w = r.w; it.h = r.h; it.blob = r.blob;
            it.thumb = URL.createObjectURL(r.blob);
            it.status = 'waiting';
            delete it.file;
            renderNew();
            uploadQueue.push(it);
            pumpUploads();
        }).catch(function () {
            it.status = 'error';
            it.error = /\.hei[cf]$/i.test(it.name) ? 'HEIC isn’t supported here — export as JPEG' : 'Couldn’t read this file';
            renderNew();
        });
    }
    function pumpUploads() {
        while (uploading < 3 && uploadQueue.length) {
            var it = uploadQueue.shift();
            if (newItems.indexOf(it) === -1) continue;
            uploading++;
            it.status = 'uploading';
            renderNew();
            (function (it) {
                apiJSON('POST', '/api/stage', it.blob, 'image/jpeg').then(function (r) {
                    it.url = r.url;
                    it.status = 'ready';
                    delete it.blob;
                    if (newItems.indexOf(it) === -1) api('DELETE', '/api/stage', { urls: [r.url] });
                }).catch(function (e) {
                    it.status = 'error';
                    it.error = e.message;
                }).finally(function () {
                    uploading--;
                    renderNew();
                    pumpUploads();
                });
            })(it);
        }
    }
    function removeItem(it) {
        newItems.splice(newItems.indexOf(it), 1);
        newSel.delete(it.id);
        if (it.url) api('DELETE', '/api/stage', { urls: [it.url] }).catch(function () {});
        if (it.thumb) URL.revokeObjectURL(it.thumb);
        renderNew();
    }

    var STATUS_TEXT = { resizing: 'Preparing…', waiting: 'Waiting…', uploading: 'Uploading…' };
    function renderNew() {
        grid.textContent = '';
        newItems.forEach(function (it, i) {
            var t = el('div', 'photo');
            t.setAttribute('data-item', it.id);
            t.draggable = it.status !== 'resizing';
            t.style.width = Math.round(180 * (it.w && it.h ? it.w / it.h : 1.5)) + 'px';
            t.classList.toggle('is-selected', newSel.has(it.id));
            if (it.thumb) { var img = el('img'); img.src = it.thumb; img.alt = ''; t.appendChild(img); }
            var x = el('button', 'photo__remove', '×'); x.type = 'button'; x.title = 'Remove';
            t.appendChild(x);
            if (it.status !== 'ready') {
                var s = el('span', 'photo__status' + (it.status === 'error' ? ' is-error' : ''), it.status === 'error' ? it.error : STATUS_TEXT[it.status]);
                t.appendChild(s);
            }
            var box = el('div', 'photo__tags');
            it.tags.forEach(function (tag) { box.appendChild(el('span', 'photo__tag photo__tag--' + (catOf(tag) || 'other'), labelOf(tag))); });
            t.appendChild(box);
            grid.appendChild(t);
        });
        newPanel.paint();
        $('new-sel-count').textContent = newSel.size ? newSel.size + ' photo' + (newSel.size === 1 ? '' : 's') + ' selected' : 'Nothing selected';
        paintPublish();
    }

    grid.addEventListener('click', function (e) {
        var t = e.target.closest('.photo');
        if (!t) { newSel.clear(); renderNew(); return; }
        var it = newItems.filter(function (x) { return String(x.id) === t.getAttribute('data-item'); })[0];
        if (e.target.closest('.photo__remove')) { removeItem(it); return; }
        if (e.shiftKey && newAnchor != null) {
            var ids = newItems.map(function (x) { return x.id; });
            var a = ids.indexOf(newAnchor), b = ids.indexOf(it.id);
            if (!(e.metaKey || e.ctrlKey)) newSel.clear();
            ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(function (id) { newSel.add(id); });
        } else if (e.metaKey || e.ctrlKey) {
            if (newSel.has(it.id)) newSel.delete(it.id); else newSel.add(it.id);
            newAnchor = it.id;
        } else {
            newSel = new Set([it.id]);
            newAnchor = it.id;
        }
        renderNew();
    });

    // Drag to reorder
    var dragItem = null;
    grid.addEventListener('dragstart', function (e) {
        var t = e.target.closest('.photo');
        if (!t) return;
        dragItem = +t.getAttribute('data-item');
        t.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragItem));
    });
    grid.addEventListener('dragover', function (e) {
        if (dragItem == null) return;
        e.preventDefault();
        grid.querySelectorAll('.is-drop-before').forEach(function (n) { n.classList.remove('is-drop-before'); });
        var t = e.target.closest('.photo');
        if (t && +t.getAttribute('data-item') !== dragItem) t.classList.add('is-drop-before');
    });
    grid.addEventListener('drop', function (e) {
        if (dragItem == null) return;
        e.preventDefault();
        var t = e.target.closest('.photo');
        var from = newItems.findIndex(function (x) { return x.id === dragItem; });
        var moved = newItems.splice(from, 1)[0];
        var to = t ? newItems.findIndex(function (x) { return String(x.id) === t.getAttribute('data-item'); }) : newItems.length;
        newItems.splice(to < 0 ? newItems.length : to, 0, moved);
        dragItem = null;
        renderNew();
    });
    grid.addEventListener('dragend', function () { dragItem = null; renderNew(); });

    function paintPublish() {
        var st = $('post-state').value;
        var ready = newItems.length && newItems.every(function (it) { return it.status === 'ready'; });
        var untagged = newItems.filter(function (it) { return !it.tags.length; }).length;
        var btn = $('btn-publish');
        btn.disabled = !ready || publishing;
        btn.textContent = publishing ? 'Posting…' : st === 'queue' ? 'Add to queue' : st === 'draft' ? 'Save draft' : 'Publish';
        $('post-date').hidden = $('post-date-label').hidden = st === 'queue';
        var note = !newItems.length ? 'Add photos to start a post.'
            : !ready ? 'Waiting for uploads to finish…'
            : untagged ? untagged + ' photo' + (untagged === 1 ? ' has' : 's have') + ' no tags (they’ll still appear on Everything).'
            : newItems.length + ' photo' + (newItems.length === 1 ? '' : 's') + ' ready.';
        $('publish-note').textContent = note;
    }

    var publishing = false;
    function publish() {
        if (publishing) return;
        var st = $('post-state').value;
        var dateVal = $('post-date').value;
        var body = {
            photos: newItems.map(function (it) { return { url: it.url, width: it.w, height: it.h, tags: it.tags }; }),
            caption: $('caption').value,
            state: st,
            date: st !== 'queue' && dateVal ? new Date(dateVal).toISOString() : null,
        };
        publishing = true;
        paintPublish();
        apiJSON('POST', '/api/publish', body).then(function (r) {
            var url = st === 'published' ? 'https://fyi.photos/post/' + r.post.id
                : 'https://www.tumblr.com/blog/' + (st === 'queue' ? 'fyi-photos/queue' : 'fyi-photos/drafts');
            toast((st === 'published' ? 'Posted! ' : st === 'queue' ? 'Added to queue. ' : 'Draft saved. ') +
                '<a href="' + url + '" target="_blank" rel="noopener">View ↗</a>', true);
            newItems.forEach(function (it) { if (it.thumb) URL.revokeObjectURL(it.thumb); });
            newItems = []; newSel.clear();
            $('caption').value = ''; $('post-date').value = '';
            if (st === 'published') loadPosts();
        }).catch(function (e) {
            toast('Couldn’t post: ' + e.message);
        }).finally(function () {
            publishing = false;
            renderNew();
        });
    }

    function newKeys(e, k) {
        if (k === 'escape') { newSel.clear(); renderNew(); }
        else if (k === 'a') { newSel = new Set(newItems.map(function (i) { return i.id; })); renderNew(); }
        else if (k === 'backspace' || k === 'delete') { selectedItems().forEach(function (it) { it.tags = []; }); renderNew(); }
        else if (/^[1-9]$/.test(k)) { if (slots[+k - 1]) newPanel.opts.onToggle(slots[+k - 1]); }
        else return false;
        return true;
    }

    /* ══ Lists & covers view ═════════════════════════════════ */

    function initListsView() {
        document.querySelectorAll('[data-add]').forEach(function (b) {
            b.addEventListener('click', function () { showAddInline(b, b.getAttribute('data-add')); });
        });
        ['travel', 'series'].forEach(function (cat) {
            var box = $('tiles-' + cat);
            var dragTag = null;
            box.addEventListener('dragstart', function (e) {
                var t = e.target.closest('.tile');
                if (!t) return;
                dragTag = t.getAttribute('data-tag');
                t.classList.add('is-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', dragTag);
            });
            box.addEventListener('dragover', function (e) {
                if (!dragTag) return;
                e.preventDefault();
                box.querySelectorAll('.is-drop-before').forEach(function (n) { n.classList.remove('is-drop-before'); });
                var t = e.target.closest('.tile');
                if (t && t.getAttribute('data-tag') !== dragTag) t.classList.add('is-drop-before');
            });
            box.addEventListener('drop', function (e) {
                if (!dragTag) return;
                e.preventDefault();
                var t = e.target.closest('.tile');
                var cfg = cloneConfig();
                var list = cfg[cat];
                var moved = list.splice(list.findIndex(function (x) { return x.tag === dragTag; }), 1)[0];
                var to = t ? list.findIndex(function (x) { return x.tag === t.getAttribute('data-tag'); }) : list.length;
                list.splice(to < 0 ? list.length : to, 0, moved);
                dragTag = null;
                saveConfig(cfg).catch(function () {});
            });
            box.addEventListener('dragend', function () { dragTag = null; renderLists(); });
            box.addEventListener('click', function (e) {
                var t = e.target.closest('.tile');
                if (!t) return;
                var tag = t.getAttribute('data-tag');
                if (e.target.closest('.js-cover')) openCoverPicker(cat, tag);
                else if (e.target.closest('.js-rename')) renameEntry(cat, tag, t.querySelector('.tile__label'));
                else if (e.target.closest('.js-remove')) removeEntry(cat, tag);
            });
        });
        $('people-list').addEventListener('click', function (e) {
            var li = e.target.closest('li');
            if (!li) return;
            var tag = li.getAttribute('data-tag');
            if (e.target.closest('.js-rename')) renameEntry('people', tag, li.querySelector('.p-label'));
            else if (e.target.closest('.js-remove')) removeEntry('people', tag);
        });
        $('modal-close').addEventListener('click', closeModal);
        $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
    }

    function showAddInline(btn, cat) {
        var head = btn.closest('.list-section__head');
        if (head.nextElementSibling && head.nextElementSibling.classList.contains('add-form')) {
            head.nextElementSibling.querySelector('input').focus();
            return;
        }
        var form = el('form', 'add-form');
        form.style.maxWidth = '420px';
        var input = el('input'); input.placeholder = 'New ' + NOUN[cat] + ' name';
        var ok = el('button', null, 'Add'); ok.type = 'submit';
        var cancel = el('button', null, 'Cancel'); cancel.type = 'button';
        form.appendChild(input); form.appendChild(ok); form.appendChild(cancel);
        head.after(form);
        input.focus();
        cancel.addEventListener('click', function () { form.remove(); });
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            addEntry(cat, input.value).then(function () { form.remove(); }).catch(function () {});
        });
    }

    function tagCounts() {
        var n = {};
        Object.keys(tags).forEach(function (pid) {
            Object.values(tags[pid]).forEach(function (l) { l.forEach(function (t) { n[t] = (n[t] || 0) + 1; }); });
        });
        return n;
    }

    function renderLists() {
        if (!store) return;
        var counts = tagCounts();
        ['travel', 'series'].forEach(function (cat) {
            var box = $('tiles-' + cat);
            box.textContent = '';
            store.config[cat].forEach(function (e, i) {
                var t = el('div', 'tile');
                t.draggable = true;
                t.setAttribute('data-tag', e.tag);
                var cover = el('div', 'tile__cover');
                cover.style.background = PASTEL[i % PASTEL.length];
                if (e.cover) { var img = el('img'); img.src = e.cover; img.alt = ''; img.loading = 'lazy'; cover.appendChild(img); }
                else cover.textContent = 'No cover';
                t.appendChild(cover);
                var meta = el('div', 'tile__meta');
                meta.appendChild(el('span', 'tile__label', e.label));
                meta.appendChild(el('span', 'muted small', loadingDone ? (counts[e.tag] || 0) + ' photos' : ''));
                t.appendChild(meta);
                var acts = el('div', 'tile__actions');
                [['js-cover', 'Set cover'], ['js-rename', 'Rename']].forEach(function (a) {
                    var b = el('button', 'link-btn ' + a[0], a[1]); b.type = 'button'; acts.appendChild(b);
                });
                if (loadingDone && !counts[e.tag]) { var r = el('button', 'link-btn js-remove', 'Remove'); r.type = 'button'; acts.appendChild(r); }
                t.appendChild(acts);
                box.appendChild(t);
            });
        });
        var ul = $('people-list');
        ul.textContent = '';
        sorted(store.config.people).forEach(function (e) {
            var li = el('li');
            li.setAttribute('data-tag', e.tag);
            li.appendChild(el('span', 'p-label', e.label));
            li.appendChild(el('span', 'p-tag', e.tag));
            li.appendChild(el('span', 'muted small', loadingDone ? String(counts[e.tag] || 0) : ''));
            var b = el('button', 'link-btn js-rename', 'Rename'); b.type = 'button'; li.appendChild(b);
            if (loadingDone && !counts[e.tag]) { var r = el('button', 'link-btn js-remove', 'Remove'); r.type = 'button'; li.appendChild(r); }
            ul.appendChild(li);
        });
    }

    function renameEntry(cat, tag, labelEl) {
        var entry = store.config[cat].filter(function (e) { return e.tag === tag; })[0];
        var input = el('input', 'inline-edit');
        input.value = entry.label;
        labelEl.textContent = '';
        labelEl.appendChild(input);
        input.focus(); input.select();
        var done = false;
        function finish(save) {
            if (done) return;
            done = true;
            var v = input.value.trim();
            if (!save || !v || v === entry.label) { renderLists(); return; }
            var cfg = cloneConfig();
            cfg[cat].forEach(function (e) { if (e.tag === tag) e.label = v; });
            saveConfig(cfg).then(function () { toast('Renamed to ' + v + ' (tag stays “' + tag + '”)'); }).catch(function () {});
        }
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') finish(true);
            if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
        });
        input.addEventListener('blur', function () { finish(true); });
    }

    function removeEntry(cat, tag) {
        var cfg = cloneConfig();
        cfg[cat] = cfg[cat].filter(function (e) { return e.tag !== tag; });
        saveConfig(cfg).then(function () { toast('Removed'); }).catch(function () {});
    }

    function openCoverPicker(cat, tag) {
        var entry = store.config[cat].filter(function (e) { return e.tag === tag; })[0];
        var currentKey = entry.cover ? photoKeyOf(entry.cover) : '';
        $('modal-title').textContent = 'Cover for ' + entry.label;
        var body = $('modal-body');
        body.textContent = '';
        var list = [];
        posts.forEach(function (p) {
            p.photos.forEach(function (ph) { if (tagsOf(p.id, ph.key).indexOf(tag) > -1) list.push(ph); });
        });
        if (!list.length) {
            body.appendChild(el('p', 'muted', loadingDone ? 'No photos are tagged ' + entry.label + ' yet.' : 'Still loading posts — try again in a moment.'));
        } else {
            var wrap = el('div', 'picker');
            list.forEach(function (ph) {
                var b = el('button');
                b.type = 'button';
                b.title = 'Use this photo';
                if (ph.key === currentKey) b.classList.add('is-current');
                var img = el('img'); img.src = ph.thumb; img.alt = ''; img.loading = 'lazy';
                b.appendChild(img);
                b.addEventListener('click', function () {
                    var cfg = cloneConfig();
                    cfg[cat].forEach(function (e) { if (e.tag === tag) e.cover = ph.full; });
                    saveConfig(cfg).then(function () { closeModal(); toast('Cover set for ' + entry.label); }).catch(function () {});
                });
                wrap.appendChild(b);
            });
            body.appendChild(wrap);
        }
        $('modal').hidden = false;
    }
    function closeModal() { $('modal').hidden = true; }

    /* ══ Keyboard ════════════════════════════════════════════ */

    document.addEventListener('keydown', function (e) {
        if (e.target.closest('input, select, textarea')) return;
        if (!$('modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
        var k = e.key.toLowerCase();
        if (view === 'tag' && (e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); undo(); return; }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        var handled = view === 'tag' ? tagKeys(e, k) : view === 'new' ? newKeys(e, k) : false;
        if (handled) e.preventDefault();
    });

    boot();
})();

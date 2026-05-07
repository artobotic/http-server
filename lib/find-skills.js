'use strict';

var fs = require('fs');
var path = require('path');

var DEFAULT_BANK_PATH = path.join(__dirname, '..', 'skills', 'bank.json');
var CANDIDATE_COUNT = 20;

var _indexCache = null;

function tokenize(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function (t) { return t.length > 1; });
}

function skillText(skill) {
  var parts = [skill.name || '', skill.description || ''];
  if (Array.isArray(skill.triggers)) {
    skill.triggers.forEach(function (t) { parts.push(t); });
  }
  return parts.join(' ');
}

function buildIndex(skills) {
  var N = skills.length;
  var df = {};

  skills.forEach(function (skill) {
    var terms = {};
    tokenize(skillText(skill)).forEach(function (t) { terms[t] = true; });
    Object.keys(terms).forEach(function (t) {
      df[t] = (df[t] || 0) + 1;
    });
  });

  var idf = {};
  Object.keys(df).forEach(function (t) {
    idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1;
  });

  return { idf: idf };
}

function scoreSkill(queryTokens, skill, idf) {
  var tokens = tokenize(skillText(skill));
  if (!tokens.length) return 0;

  var tf = {};
  tokens.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });

  var total = 0;
  queryTokens.forEach(function (qt) {
    if (tf[qt]) {
      total += (tf[qt] / tokens.length) * (idf[qt] || 1);
    }
  });
  return total;
}

function rerankWithClaude(query, candidates, limit) {
  var Anthropic;
  try {
    var mod = require('@anthropic-ai/sdk');
    Anthropic = mod.default || mod;
  } catch (e) {
    return Promise.resolve(candidates.slice(0, limit));
  }

  var client = new Anthropic();
  var skillList = candidates.map(function (c) {
    return JSON.stringify({ id: c.skill.id, name: c.skill.name, description: c.skill.description });
  }).join('\n');

  return client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: 'Rank these skills by relevance to the user query. Return a JSON array of skill IDs ordered from most to least relevant. Only include skills that are actually relevant.\n\nUser query: "' + query + '"\n\nSkills:\n' + skillList + '\n\nReturn only a valid JSON array of IDs, e.g.: ["id1","id2"]'
    }]
  }).then(function (resp) {
    var text = resp.content[0].text.trim();
    var match = text.match(/\[[\s\S]*\]/);
    if (!match) return candidates.slice(0, limit);

    var ids;
    try { ids = JSON.parse(match[0]); } catch (e) { return candidates.slice(0, limit); }

    var idMap = {};
    candidates.forEach(function (c) { idMap[c.skill.id] = c; });

    var ranked = ids
      .filter(function (id) { return idMap[id]; })
      .map(function (id) { return idMap[id]; });

    candidates.forEach(function (c) {
      if (!ranked.some(function (r) { return r.skill.id === c.skill.id; })) {
        ranked.push(c);
      }
    });

    return ranked.slice(0, limit);
  }).catch(function () {
    return candidates.slice(0, limit);
  });
}

/**
 * Find skills relevant to a natural language query.
 *
 * @param {string} query - The user's query.
 * @param {object} [options]
 * @param {number}  [options.limit=5]             - Max results to return.
 * @param {string}  [options.bankPath]             - Path to skills JSON file.
 * @param {Array}   [options.skills]               - Skills array (overrides bankPath).
 * @param {boolean} [options.useClaudeRerank]      - Force-enable/disable Claude re-ranking.
 *                                                   Defaults to true when ANTHROPIC_API_KEY is set.
 * @returns {Promise<Array<{skill: object, score: number}>>}
 */
function findSkills(query, options) {
  var opts = options || {};
  var limit = Math.min(opts.limit || 5, 50);
  var bankPath = opts.bankPath || DEFAULT_BANK_PATH;
  var skills = opts.skills || JSON.parse(fs.readFileSync(bankPath, 'utf8'));
  var useRerank = opts.useClaudeRerank !== undefined
    ? opts.useClaudeRerank
    : !!process.env.ANTHROPIC_API_KEY;

  if (!query || !query.trim() || !skills.length) {
    return Promise.resolve([]);
  }

  if (!_indexCache || _indexCache.size !== skills.length) {
    _indexCache = Object.assign({ size: skills.length }, buildIndex(skills));
  }

  var queryTokens = tokenize(query);
  var scored = skills.map(function (skill) {
    return { skill: skill, score: scoreSkill(queryTokens, skill, _indexCache.idf) };
  });
  scored.sort(function (a, b) { return b.score - a.score; });

  var candidates = scored.slice(0, CANDIDATE_COUNT);

  if (useRerank && process.env.ANTHROPIC_API_KEY) {
    return rerankWithClaude(query, candidates, limit);
  }

  return Promise.resolve(candidates.slice(0, limit));
}

module.exports = { findSkills: findSkills };

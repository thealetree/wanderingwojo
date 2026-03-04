#!/usr/bin/env python3
"""
Wandering Wojo — Local Journal Entry Tool

Run this script to open a browser-based form for adding new journal entries.
Entries are saved to data/entries.json and pushed to git automatically.

Usage:
    python3 tools/journal.py
    python3 tools/journal.py --port 8888
"""

import http.server
import json
import os
import re
import subprocess
import sys
import threading
import webbrowser
from datetime import date
from urllib.parse import urlparse

PORT = 5555
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
ENTRIES_FILE = os.path.join(PROJECT_ROOT, 'data', 'entries.json')

# ---------------------------------------------------------------------------
# Embedded HTML page
# ---------------------------------------------------------------------------

HTML_PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wandering Wojo — Journal Tool</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    /* ---- Design Tokens ---- */
    :root {
      --white: #FFFFFF;
      --off-white: #FAF9F6;
      --beige: #F2EFE9;
      --beige-dark: #E5E0D8;
      --warm-gray: #C4BFB6;
      --mid-gray: #999590;
      --dark-gray: #6B6660;
      --charcoal: #3D3A37;
      --near-black: #1A1817;
      --bg-page: var(--off-white);
      --bg-card: var(--white);
      --border-subtle: var(--beige-dark);
      --font-display: 'DM Sans', 'Inter', -apple-system, sans-serif;
      --font-body: 'Inter', -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', 'SF Mono', monospace;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03);
      --shadow-md: 0 4px 16px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04);
      --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --white: #1A1817;
        --off-white: #1E1D1B;
        --beige: #2A2825;
        --beige-dark: #353230;
        --warm-gray: #5A5652;
        --mid-gray: #8A8580;
        --dark-gray: #B0ABA5;
        --charcoal: #D4D0CC;
        --near-black: #F0EEEB;
        --bg-page: var(--off-white);
        --bg-card: var(--white);
        --border-subtle: var(--beige-dark);
        --shadow-sm: 0 1px 3px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.15);
        --shadow-md: 0 4px 16px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.2);
      }
    }

    /* ---- Reset ---- */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html { font-size: 16px; -webkit-font-smoothing: antialiased; }

    body {
      font-family: var(--font-body);
      font-size: 0.9375rem;
      line-height: 1.6;
      color: var(--near-black);
      background: var(--bg-page);
      min-height: 100vh;
    }

    /* ---- Layout ---- */
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }

    .header {
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--beige-dark);
    }

    .header__title {
      font-family: var(--font-display);
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--near-black);
    }

    .header__subtitle {
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      color: var(--mid-gray);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-top: 0.25rem;
    }

    .layout {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
      align-items: start;
    }

    @media (max-width: 768px) {
      .layout { grid-template-columns: 1fr; }
    }

    /* ---- Form ---- */
    .form-group { margin-bottom: 1.25rem; }

    .form-label {
      display: block;
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--mid-gray);
      margin-bottom: 0.375rem;
    }

    .form-input,
    .form-textarea,
    .form-select {
      width: 100%;
      font-family: var(--font-body);
      font-size: 0.9375rem;
      padding: 0.625rem 0.875rem;
      background: var(--bg-card);
      border: 1px solid var(--beige-dark);
      border-radius: 8px;
      color: var(--near-black);
      outline: none;
      box-shadow: var(--shadow-sm);
      transition: border-color 0.2s;
    }

    .form-input:focus,
    .form-textarea:focus,
    .form-select:focus {
      border-color: var(--warm-gray);
    }

    .form-textarea {
      min-height: 180px;
      resize: vertical;
      line-height: 1.7;
    }

    .form-select {
      appearance: none;
      cursor: pointer;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23999590' stroke-width='1.5' fill='none'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 0.875rem center;
      padding-right: 2.25rem;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .form-row-3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 1rem;
    }

    .form-hint {
      font-family: var(--font-mono);
      font-size: 0.625rem;
      color: var(--warm-gray);
      margin-top: 0.25rem;
    }

    /* ---- Mood slider ---- */
    .mood-preview {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.5rem;
      padding: 0.5rem 0;
    }

    .mood-label {
      font-family: var(--font-mono);
      font-size: 0.625rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--mid-gray);
      white-space: nowrap;
      min-width: 3rem;
    }

    .mood-label--right { text-align: right; }

    .mood-bar {
      flex: 1;
      height: 3px;
      background: var(--beige);
      border-radius: 2px;
      overflow: hidden;
    }

    .mood-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.3s ease, background 0.3s ease;
    }

    .form-range {
      width: 100%;
      height: 3px;
      appearance: none;
      background: var(--beige-dark);
      border-radius: 2px;
      outline: none;
      cursor: pointer;
      margin-top: 0.25rem;
    }

    .form-range::-webkit-slider-thumb {
      appearance: none;
      width: 16px;
      height: 16px;
      background: var(--near-black);
      border-radius: 50%;
      cursor: pointer;
    }

    .form-range::-moz-range-thumb {
      width: 16px;
      height: 16px;
      background: var(--near-black);
      border-radius: 50%;
      cursor: pointer;
      border: none;
    }

    /* ---- Buttons ---- */
    .btn {
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-primary {
      background: var(--near-black);
      color: var(--off-white);
    }

    .btn-primary:hover { opacity: 0.85; }

    .btn-primary:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .btn-secondary {
      background: transparent;
      color: var(--mid-gray);
      border: 1px solid var(--beige-dark);
    }

    .btn-secondary:hover {
      border-color: var(--warm-gray);
      color: var(--charcoal);
    }

    .btn-group {
      display: flex;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }

    /* ---- Status ---- */
    .status {
      margin-top: 1rem;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      line-height: 1.8;
      color: var(--mid-gray);
      min-height: 1.5rem;
    }

    .status--success { color: #5a8; }
    .status--error { color: #c44; }

    .status-step {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .status-step::before {
      content: '·';
      color: var(--warm-gray);
    }

    .status-step.done::before { content: '\2713'; color: #5a8; }
    .status-step.fail::before { content: '\2717'; color: #c44; }

    /* ---- Entry List ---- */
    .entry-list-section {
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--beige-dark);
    }

    .entry-list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
      padding: 0.5rem 0;
    }

    .entry-list-header:hover .entry-list-toggle { color: var(--charcoal); }

    .entry-list-title {
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--mid-gray);
    }

    .entry-list-toggle {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--warm-gray);
      transition: color 0.2s, transform 0.2s;
    }

    .entry-list-toggle.open { transform: rotate(180deg); }

    .entry-list {
      display: none;
      margin-top: 0.75rem;
    }

    .entry-list.open { display: block; }

    .entry-list-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.625rem 0.75rem;
      margin-bottom: 0.375rem;
      background: var(--bg-card);
      border: 1px solid var(--beige-dark);
      border-radius: 8px;
      cursor: pointer;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .entry-list-item:hover {
      border-color: var(--warm-gray);
      box-shadow: var(--shadow-sm);
    }

    .entry-list-item.active {
      border-color: var(--charcoal);
      box-shadow: var(--shadow-md);
    }

    .entry-list-item__info {
      flex: 1;
      min-width: 0;
    }

    .entry-list-item__title {
      font-family: var(--font-display);
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--near-black);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .entry-list-item__meta {
      font-family: var(--font-mono);
      font-size: 0.5625rem;
      color: var(--mid-gray);
      letter-spacing: 0.04em;
      margin-top: 0.125rem;
    }

    .entry-list-item__actions {
      display: flex;
      gap: 0.375rem;
      flex-shrink: 0;
    }

    .btn-icon {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--beige-dark);
      border-radius: 6px;
      background: transparent;
      color: var(--mid-gray);
      cursor: pointer;
      font-size: 0.75rem;
      transition: all 0.2s;
    }

    .btn-icon:hover {
      color: var(--charcoal);
      border-color: var(--warm-gray);
    }

    .btn-icon--delete:hover {
      color: #c44;
      border-color: #c44;
    }

    .entry-list-empty {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--warm-gray);
      font-style: italic;
      padding: 0.5rem 0;
    }

    .editing-banner {
      display: none;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      margin-bottom: 1rem;
      background: var(--beige);
      border: 1px solid var(--beige-dark);
      border-radius: 8px;
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      color: var(--charcoal);
    }

    .editing-banner.active { display: flex; }

    .editing-banner__cancel {
      font-family: var(--font-mono);
      font-size: 0.625rem;
      color: var(--mid-gray);
      background: none;
      border: none;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .editing-banner__cancel:hover { color: var(--charcoal); }

    /* ---- Preview Card ---- */
    .preview-section {
      position: sticky;
      top: 2rem;
    }

    .preview-label {
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--mid-gray);
      margin-bottom: 1rem;
    }

    .preview-card {
      background: var(--bg-card);
      border: 1px solid var(--beige-dark);
      border-radius: 10px;
      padding: 1.5rem;
      box-shadow: var(--shadow-md);
    }

    .preview-card__type {
      font-family: var(--font-mono);
      font-size: 0.5625rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      margin-bottom: 0.5rem;
      color: var(--dark-gray);
      background: var(--beige);
    }

    .preview-card__title {
      font-family: var(--font-display);
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--near-black);
      margin-bottom: 0.375rem;
    }

    .preview-card__meta {
      font-family: var(--font-mono);
      font-size: 0.6875rem;
      color: var(--mid-gray);
      margin-bottom: 0.75rem;
    }

    .preview-card__body {
      font-family: var(--font-body);
      font-size: 0.9375rem;
      color: var(--charcoal);
      line-height: 1.65;
    }

    .preview-card__body p { margin-bottom: 0.75rem; }

    .preview-mood {
      margin-top: 1rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--beige);
    }

    .preview-empty {
      color: var(--warm-gray);
      font-style: italic;
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header__title">Journal Tool</div>
      <div class="header__subtitle">Wandering Wojo — Journal Manager</div>
    </div>

    <!-- Entry List -->
    <div class="entry-list-section">
      <div class="entry-list-header" id="entry-list-header">
        <span class="entry-list-title">Existing Entries (<span id="entry-count">0</span>)</span>
        <span class="entry-list-toggle" id="entry-list-toggle">&#9660;</span>
      </div>
      <div class="entry-list" id="entry-list">
        <div class="entry-list-empty" id="entry-list-empty">Loading entries...</div>
      </div>
    </div>

    <!-- Editing Banner -->
    <div class="editing-banner" id="editing-banner">
      <span>Editing: <strong id="editing-title"></strong></span>
      <button class="editing-banner__cancel" id="editing-cancel">Cancel &amp; New</button>
    </div>

    <div class="layout">
      <!-- Form Column -->
      <div class="form-column">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="entry-title">Title *</label>
            <input class="form-input" id="entry-title" type="text" placeholder="Red country" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="entry-date">Date *</label>
            <input class="form-input" id="entry-date" type="date" required>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="entry-type">Type</label>
            <select class="form-select" id="entry-type">
              <option value="field-notes">Field Notes (Wojo voice)</option>
              <option value="dispatch">Dispatch (Van voice)</option>
              <option value="video-log">Video Log</option>
              <option value="wojo-report">Wojo Report</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="entry-location">Location *</label>
            <input class="form-input" id="entry-location" type="text" placeholder="Moab, Utah" required>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="entry-lat">Latitude *</label>
            <input class="form-input" id="entry-lat" type="number" step="any" placeholder="38.5733" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="entry-lng">Longitude *</label>
            <input class="form-input" id="entry-lng" type="number" step="any" placeholder="-109.5498" required>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="entry-body">Body *</label>
          <textarea class="form-textarea" id="entry-body" placeholder="Write your entry here. Use double line breaks for new paragraphs." required></textarea>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="entry-video">Video URL (optional)</label>
            <input class="form-input" id="entry-video" type="url" placeholder="https://www.youtube.com/embed/...">
            <div class="form-hint">YouTube embed URL</div>
          </div>
          <div class="form-group">
            <label class="form-label" for="entry-photos">Photos (optional)</label>
            <input class="form-input" id="entry-photos" type="text" placeholder="media/photos/pic1.jpg, pic2.jpg">
            <div class="form-hint">Comma-separated paths</div>
          </div>
        </div>

        <div class="form-group" style="margin-top: 0.5rem; padding-top: 1rem; border-top: 1px solid var(--beige-dark);">
          <label class="form-label">Mood Bar</label>
          <div class="form-row-3">
            <div class="form-group">
              <label class="form-label" for="mood-left">Left label</label>
              <input class="form-input" id="mood-left" type="text" placeholder="calm">
            </div>
            <div class="form-group">
              <label class="form-label" for="mood-right">Right label</label>
              <input class="form-input" id="mood-right" type="text" placeholder="restless">
            </div>
            <div class="form-group">
              <label class="form-label" for="mood-value">Position</label>
              <input class="form-range" id="mood-value" type="range" min="0" max="1" step="0.05" value="0.5">
            </div>
          </div>
          <div class="mood-preview">
            <span class="mood-label" id="mood-left-preview">calm</span>
            <div class="mood-bar">
              <div class="mood-fill" id="mood-fill-preview" style="width:50%;background:rgb(159,111,70);"></div>
            </div>
            <span class="mood-label mood-label--right" id="mood-right-preview">restless</span>
          </div>
        </div>

        <div class="btn-group">
          <button class="btn btn-primary" id="btn-save">Save New & Push</button>
          <button class="btn btn-secondary" id="btn-clear">Clear</button>
        </div>

        <div class="status" id="status"></div>
      </div>

      <!-- Preview Column -->
      <div class="preview-section">
        <div class="preview-label">Live Preview</div>
        <div class="preview-card" id="preview-card">
          <div class="preview-empty">Fill in the form to see a preview...</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // ---- Elements ----
    var fields = {
      title: document.getElementById('entry-title'),
      date: document.getElementById('entry-date'),
      type: document.getElementById('entry-type'),
      location: document.getElementById('entry-location'),
      lat: document.getElementById('entry-lat'),
      lng: document.getElementById('entry-lng'),
      body: document.getElementById('entry-body'),
      video: document.getElementById('entry-video'),
      photos: document.getElementById('entry-photos'),
      moodLeft: document.getElementById('mood-left'),
      moodRight: document.getElementById('mood-right'),
      moodValue: document.getElementById('mood-value'),
    };

    var preview = document.getElementById('preview-card');
    var statusEl = document.getElementById('status');
    var btnSave = document.getElementById('btn-save');
    var btnClear = document.getElementById('btn-clear');
    var moodFill = document.getElementById('mood-fill-preview');
    var moodLeftPreview = document.getElementById('mood-left-preview');
    var moodRightPreview = document.getElementById('mood-right-preview');

    // Entry list elements
    var entryListHeader = document.getElementById('entry-list-header');
    var entryListToggle = document.getElementById('entry-list-toggle');
    var entryListEl = document.getElementById('entry-list');
    var entryListEmpty = document.getElementById('entry-list-empty');
    var entryCountEl = document.getElementById('entry-count');
    var editingBanner = document.getElementById('editing-banner');
    var editingTitleEl = document.getElementById('editing-title');
    var editingCancel = document.getElementById('editing-cancel');

    // ---- State ----
    var editingId = null;  // null = new entry mode, string = editing existing entry

    // ---- Set today as default date ----
    fields.date.value = new Date().toISOString().split('T')[0];

    // ---- Mood color interpolation (sage to terracotta) ----
    function getMoodColor(value) {
      var r = Math.round(124 + (193 - 124) * value);
      var g = Math.round(154 + (68 - 154) * value);
      var b = Math.round(126 + (14 - 126) * value);
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    // ---- Update mood bar preview ----
    function updateMoodPreview() {
      var val = parseFloat(fields.moodValue.value);
      var left = fields.moodLeft.value || 'calm';
      var right = fields.moodRight.value || 'restless';
      moodLeftPreview.textContent = left;
      moodRightPreview.textContent = right;
      moodFill.style.width = Math.round(val * 100) + '%';
      moodFill.style.background = getMoodColor(val);
    }

    fields.moodLeft.addEventListener('input', updateMoodPreview);
    fields.moodRight.addEventListener('input', updateMoodPreview);
    fields.moodValue.addEventListener('input', updateMoodPreview);

    // ---- Generate entry ID ----
    function generateId(title, dateStr) {
      var slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return dateStr + '-' + (slug || 'entry');
    }

    // ---- Escape HTML ----
    function escapeHtml(str) {
      if (!str) return '';
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // ---- Format type ----
    function formatType(type) {
      return type ? type.replace(/-/g, ' ').toUpperCase() : '';
    }

    // ---- Format date for display ----
    function formatDate(dateStr) {
      if (!dateStr) return '';
      var d = new Date(dateStr + 'T00:00:00');
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }

    // ---- Update live preview ----
    function updatePreview() {
      var title = fields.title.value.trim();
      var body = fields.body.value.trim();
      var type = fields.type.value;
      var loc = fields.location.value.trim();
      var dateVal = fields.date.value;
      var moodLeft = fields.moodLeft.value.trim();
      var moodRight = fields.moodRight.value.trim();
      var moodVal = parseFloat(fields.moodValue.value);

      if (!title && !body) {
        preview.innerHTML = '<div class="preview-empty">Fill in the form to see a preview...</div>';
        return;
      }

      var bodyHtml = '';
      if (body) {
        bodyHtml = body.split(/\n\n+/).map(function(p) {
          return '<p>' + escapeHtml(p.trim()) + '</p>';
        }).join('');
      }

      var moodHtml = '';
      if (moodLeft && moodRight) {
        var color = getMoodColor(moodVal);
        var width = Math.round(moodVal * 100);
        moodHtml =
          '<div class="preview-mood">' +
            '<div class="mood-preview">' +
              '<span class="mood-label">' + escapeHtml(moodLeft) + '</span>' +
              '<div class="mood-bar">' +
                '<div class="mood-fill" style="width:' + width + '%;background:' + color + ';"></div>' +
              '</div>' +
              '<span class="mood-label mood-label--right">' + escapeHtml(moodRight) + '</span>' +
            '</div>' +
          '</div>';
      }

      preview.innerHTML =
        '<div class="preview-card__type">' + formatType(type) + '</div>' +
        '<div class="preview-card__title">' + escapeHtml(title || 'Untitled') + '</div>' +
        '<div class="preview-card__meta">' +
          escapeHtml(loc || '...') + ' \u00b7 ' + (dateVal || '...') +
        '</div>' +
        '<div class="preview-card__body">' + bodyHtml + '</div>' +
        moodHtml;
    }

    // Listen to all fields for live preview
    Object.values(fields).forEach(function(field) {
      field.addEventListener('input', updatePreview);
    });

    // ==================================================================
    // ENTRY LIST
    // ==================================================================

    // Toggle list open/close
    entryListHeader.addEventListener('click', function() {
      entryListEl.classList.toggle('open');
      entryListToggle.classList.toggle('open');
    });

    // Load entries from server
    async function loadEntryList() {
      try {
        var resp = await fetch('/api/entries');
        var entries = await resp.json();

        // Sort chronologically (newest first for the list)
        entries.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });

        entryCountEl.textContent = entries.length;

        if (entries.length === 0) {
          entryListEmpty.textContent = 'No entries yet.';
          entryListEmpty.style.display = '';
          return;
        }

        entryListEmpty.style.display = 'none';

        // Remove old items (keep the empty message element)
        entryListEl.querySelectorAll('.entry-list-item').forEach(function(el) { el.remove(); });

        entries.forEach(function(entry) {
          var item = document.createElement('div');
          item.className = 'entry-list-item';
          if (editingId === entry.id) item.classList.add('active');
          item.setAttribute('data-id', entry.id);

          item.innerHTML =
            '<div class="entry-list-item__info">' +
              '<div class="entry-list-item__title">' + escapeHtml(entry.title) + '</div>' +
              '<div class="entry-list-item__meta">' +
                formatType(entry.type) + ' \u00b7 ' +
                escapeHtml(entry.location_name || '') + ' \u00b7 ' +
                formatDate(entry.date) +
              '</div>' +
            '</div>' +
            '<div class="entry-list-item__actions">' +
              '<button class="btn-icon btn-icon--edit" title="Edit" data-action="edit">\u270e</button>' +
              '<button class="btn-icon btn-icon--delete" title="Delete" data-action="delete">\u2715</button>' +
            '</div>';

          // Click the row to edit
          item.querySelector('.btn-icon--edit').addEventListener('click', function(e) {
            e.stopPropagation();
            loadEntryForEditing(entry);
          });

          item.addEventListener('click', function() {
            loadEntryForEditing(entry);
          });

          // Delete button
          item.querySelector('.btn-icon--delete').addEventListener('click', function(e) {
            e.stopPropagation();
            deleteEntry(entry);
          });

          entryListEl.appendChild(item);
        });
      } catch (err) {
        entryListEmpty.textContent = 'Failed to load entries.';
        console.error('Failed to load entries:', err);
      }
    }

    // Load entry into form for editing
    function loadEntryForEditing(entry) {
      editingId = entry.id;

      fields.title.value = entry.title || '';
      fields.date.value = entry.date || '';
      fields.type.value = entry.type || 'field-notes';
      fields.location.value = entry.location_name || '';
      fields.lat.value = entry.coordinates ? entry.coordinates[0] : '';
      fields.lng.value = entry.coordinates ? entry.coordinates[1] : '';
      fields.body.value = entry.body || '';
      fields.video.value = entry.video_url || '';
      fields.photos.value = (entry.photos || []).join(', ');
      fields.moodLeft.value = entry.mood_left || '';
      fields.moodRight.value = entry.mood_right || '';
      fields.moodValue.value = entry.mood_value != null ? entry.mood_value : 0.5;

      // Update UI
      btnSave.textContent = 'Update & Push';
      editingBanner.classList.add('active');
      editingTitleEl.textContent = entry.title || 'Untitled';
      statusEl.innerHTML = '';

      // Highlight in list
      entryListEl.querySelectorAll('.entry-list-item').forEach(function(el) {
        el.classList.toggle('active', el.getAttribute('data-id') === entry.id);
      });

      updateMoodPreview();
      updatePreview();

      // Scroll form into view
      fields.title.scrollIntoView({ behavior: 'smooth', block: 'center' });
      fields.title.focus();
    }

    // Switch back to new entry mode
    function switchToNewMode() {
      editingId = null;
      btnSave.textContent = 'Save New & Push';
      editingBanner.classList.remove('active');
      statusEl.innerHTML = '';

      // Clear active highlight
      entryListEl.querySelectorAll('.entry-list-item').forEach(function(el) {
        el.classList.remove('active');
      });
    }

    // Cancel editing
    editingCancel.addEventListener('click', function() {
      switchToNewMode();
      clearForm();
    });

    // Delete an entry
    async function deleteEntry(entry) {
      if (!confirm('Delete "' + entry.title + '"? This will push the change to GitHub.')) return;

      statusEl.innerHTML = '<div class="status-step">Deleting entry...</div>';

      try {
        var resp = await fetch('/api/delete-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: entry.id })
        });

        var result = await resp.json();
        var html = '';

        if (result.saved) {
          html += '<div class="status-step done">Entry deleted from entries.json</div>';
        } else {
          html += '<div class="status-step fail">Failed: ' + escapeHtml(result.save_error || 'Unknown') + '</div>';
        }
        if (result.committed) html += '<div class="status-step done">Committed to git</div>';
        if (result.pushed) html += '<div class="status-step done">Pushed to remote</div>';
        if (result.commit_error) html += '<div class="status-step fail">Git: ' + escapeHtml(result.commit_error) + '</div>';
        if (result.push_error) html += '<div class="status-step fail">Push: ' + escapeHtml(result.push_error) + '</div>';

        statusEl.innerHTML = html;

        // If we were editing this entry, switch to new mode
        if (editingId === entry.id) switchToNewMode();

        // Reload list
        loadEntryList();
      } catch (err) {
        statusEl.innerHTML = '<div class="status-step fail">Network error: ' + escapeHtml(err.message) + '</div>';
      }
    }

    // ==================================================================
    // CLEAR FORM
    // ==================================================================

    function clearForm() {
      Object.values(fields).forEach(function(f) {
        if (f.tagName === 'SELECT') {
          f.selectedIndex = 0;
        } else if (f.type === 'range') {
          f.value = 0.5;
        } else {
          f.value = '';
        }
      });
      fields.date.value = new Date().toISOString().split('T')[0];
      updateMoodPreview();
      updatePreview();
      statusEl.innerHTML = '';
    }

    btnClear.addEventListener('click', function() {
      switchToNewMode();
      clearForm();
    });

    // ==================================================================
    // SAVE / UPDATE
    // ==================================================================

    btnSave.addEventListener('click', async function() {
      // Validate
      var missing = [];
      if (!fields.title.value.trim()) missing.push('Title');
      if (!fields.date.value) missing.push('Date');
      if (!fields.body.value.trim()) missing.push('Body');
      if (!fields.location.value.trim()) missing.push('Location');
      if (!fields.lat.value) missing.push('Latitude');
      if (!fields.lng.value) missing.push('Longitude');

      if (missing.length > 0) {
        statusEl.innerHTML = '<div class="status-step fail">Missing required fields: ' + missing.join(', ') + '</div>';
        return;
      }

      // Build entry object
      var entry = {
        id: editingId || generateId(fields.title.value.trim(), fields.date.value),
        date: fields.date.value,
        title: fields.title.value.trim(),
        type: fields.type.value,
        location_name: fields.location.value.trim(),
        coordinates: [parseFloat(fields.lat.value), parseFloat(fields.lng.value)],
        body: fields.body.value.trim(),
        video_url: fields.video.value.trim() || null,
        photos: fields.photos.value.trim()
          ? fields.photos.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
          : [],
        mood_left: fields.moodLeft.value.trim() || null,
        mood_right: fields.moodRight.value.trim() || null,
        mood_value: parseFloat(fields.moodValue.value)
      };

      if (!entry.mood_left || !entry.mood_right) {
        delete entry.mood_left;
        delete entry.mood_right;
        delete entry.mood_value;
      }

      var isUpdate = !!editingId;
      var endpoint = isUpdate ? '/api/update-entry' : '/api/save-entry';
      var actionLabel = isUpdate ? 'Updating' : 'Saving';

      btnSave.disabled = true;
      statusEl.innerHTML = '<div class="status-step">' + actionLabel + ' entry...</div>';

      try {
        var response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry)
        });

        var result = await response.json();
        var html = '';

        if (result.saved) {
          html += '<div class="status-step done">Entry ' + (isUpdate ? 'updated' : 'saved') + ' in entries.json</div>';
        } else {
          html += '<div class="status-step fail">Failed: ' + escapeHtml(result.save_error || 'Unknown') + '</div>';
        }
        if (result.committed) html += '<div class="status-step done">Committed to git</div>';
        else if (result.commit_error) html += '<div class="status-step fail">Git: ' + escapeHtml(result.commit_error) + '</div>';
        if (result.pushed) html += '<div class="status-step done">Pushed to remote</div>';
        else if (result.push_error) html += '<div class="status-step fail">Push: ' + escapeHtml(result.push_error) + '</div>';

        if (result.saved && result.pushed) {
          html += '<div style="margin-top:0.75rem;color:#5a8;font-weight:500;">\u2713 ' + (isUpdate ? 'Updated' : 'Published') + ' successfully!</div>';
        } else if (result.saved) {
          html += '<div style="margin-top:0.75rem;color:var(--mid-gray);">Saved locally. Push manually if needed.</div>';
        }

        statusEl.innerHTML = html;

        // Reload the list
        loadEntryList();

        // If new entry, keep editing ID in case they want to update again
        if (!isUpdate && result.saved) {
          editingId = entry.id;
          btnSave.textContent = 'Update & Push';
          editingBanner.classList.add('active');
          editingTitleEl.textContent = entry.title;
        }
      } catch (err) {
        statusEl.innerHTML = '<div class="status-step fail">Network error: ' + escapeHtml(err.message) + '</div>';
      }

      btnSave.disabled = false;
    });

    // ==================================================================
    // INIT
    // ==================================================================
    updateMoodPreview();
    loadEntryList();
  </script>
</body>
</html>
"""

# ---------------------------------------------------------------------------
# HTTP Handler
# ---------------------------------------------------------------------------

class JournalHandler(http.server.BaseHTTPRequestHandler):
    """Simple HTTP handler for the journal tool."""

    def log_message(self, format, *args):
        """Quieter logging."""
        sys.stderr.write(f"  {args[0]}\n")

    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(HTML_PAGE.encode('utf-8'))
        elif self.path == '/api/entries':
            self.handle_list_entries()
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == '/api/save-entry':
            self.handle_save_entry()
        elif self.path == '/api/update-entry':
            self.handle_update_entry()
        elif self.path == '/api/delete-entry':
            self.handle_delete_entry()
        else:
            self.send_error(404)

    def handle_list_entries(self):
        """Return all entries as JSON."""
        try:
            with open(ENTRIES_FILE, 'r', encoding='utf-8') as f:
                entries = json.load(f)
            self.send_json(200, entries)
        except (FileNotFoundError, json.JSONDecodeError):
            self.send_json(200, [])

    def handle_save_entry(self):
        """Save a new entry to entries.json and push to git."""
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        result = {
            'saved': False,
            'committed': False,
            'pushed': False,
        }

        try:
            entry = json.loads(body)
        except json.JSONDecodeError as e:
            result['save_error'] = f'Invalid JSON: {e}'
            self.send_json(400, result)
            return

        # Read existing entries
        try:
            with open(ENTRIES_FILE, 'r', encoding='utf-8') as f:
                entries = json.load(f)
        except FileNotFoundError:
            entries = []
        except json.JSONDecodeError:
            result['save_error'] = 'entries.json is malformed'
            self.send_json(500, result)
            return

        # Append and write
        entries.append(entry)
        try:
            with open(ENTRIES_FILE, 'w', encoding='utf-8') as f:
                json.dump(entries, f, indent=2, ensure_ascii=False)
                f.write('\n')
            result['saved'] = True
            print(f"  ✓ Saved entry: {entry.get('title', 'Untitled')}")
        except OSError as e:
            result['save_error'] = str(e)
            self.send_json(500, result)
            return

        self._git_commit_and_push(result, f"Add entry: {entry.get('title', 'New entry')}")
        self.send_json(200, result)

    def handle_update_entry(self):
        """Update an existing entry in entries.json by ID."""
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        result = {'saved': False, 'committed': False, 'pushed': False}

        try:
            updated_entry = json.loads(body)
        except json.JSONDecodeError as e:
            result['save_error'] = f'Invalid JSON: {e}'
            self.send_json(400, result)
            return

        entry_id = updated_entry.get('id')
        if not entry_id:
            result['save_error'] = 'Missing entry ID'
            self.send_json(400, result)
            return

        try:
            with open(ENTRIES_FILE, 'r', encoding='utf-8') as f:
                entries = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            result['save_error'] = 'Could not read entries.json'
            self.send_json(500, result)
            return

        # Find and replace the entry
        found = False
        for i, entry in enumerate(entries):
            if entry.get('id') == entry_id:
                entries[i] = updated_entry
                found = True
                break

        if not found:
            result['save_error'] = f'Entry not found: {entry_id}'
            self.send_json(404, result)
            return

        try:
            with open(ENTRIES_FILE, 'w', encoding='utf-8') as f:
                json.dump(entries, f, indent=2, ensure_ascii=False)
                f.write('\n')
            result['saved'] = True
            print(f"  \u2713 Updated entry: {updated_entry.get('title', 'Untitled')}")
        except OSError as e:
            result['save_error'] = str(e)
            self.send_json(500, result)
            return

        self._git_commit_and_push(result, f"Update entry: {updated_entry.get('title', 'Untitled')}")
        self.send_json(200, result)

    def handle_delete_entry(self):
        """Delete an entry from entries.json by ID."""
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        result = {'saved': False, 'committed': False, 'pushed': False}

        try:
            data = json.loads(body)
        except json.JSONDecodeError as e:
            result['save_error'] = f'Invalid JSON: {e}'
            self.send_json(400, result)
            return

        entry_id = data.get('id')
        if not entry_id:
            result['save_error'] = 'Missing entry ID'
            self.send_json(400, result)
            return

        try:
            with open(ENTRIES_FILE, 'r', encoding='utf-8') as f:
                entries = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            result['save_error'] = 'Could not read entries.json'
            self.send_json(500, result)
            return

        title = 'Unknown'
        new_entries = []
        for e in entries:
            if e.get('id') == entry_id:
                title = e.get('title', 'Untitled')
            else:
                new_entries.append(e)

        if len(new_entries) == len(entries):
            result['save_error'] = f'Entry not found: {entry_id}'
            self.send_json(404, result)
            return

        try:
            with open(ENTRIES_FILE, 'w', encoding='utf-8') as f:
                json.dump(new_entries, f, indent=2, ensure_ascii=False)
                f.write('\n')
            result['saved'] = True
            print(f"  \u2713 Deleted entry: {title}")
        except OSError as e:
            result['save_error'] = str(e)
            self.send_json(500, result)
            return

        self._git_commit_and_push(result, f"Delete entry: {title}")
        self.send_json(200, result)

    def _git_commit_and_push(self, result, message):
        """Shared git commit + push logic."""
        try:
            subprocess.run(
                ['git', 'add', 'data/entries.json'],
                cwd=PROJECT_ROOT,
                capture_output=True, text=True, check=True
            )
            commit_result = subprocess.run(
                ['git', 'commit', '-m', message],
                cwd=PROJECT_ROOT,
                capture_output=True, text=True
            )
            if commit_result.returncode == 0:
                result['committed'] = True
                print(f"  \u2713 Committed")
            else:
                result['commit_error'] = commit_result.stderr.strip() or commit_result.stdout.strip()
        except FileNotFoundError:
            result['commit_error'] = 'git not found'
        except subprocess.CalledProcessError as e:
            result['commit_error'] = e.stderr.strip()

        if result['committed']:
            try:
                push_result = subprocess.run(
                    ['git', 'push'],
                    cwd=PROJECT_ROOT,
                    capture_output=True, text=True,
                    timeout=30
                )
                if push_result.returncode == 0:
                    result['pushed'] = True
                    print(f"  \u2713 Pushed to remote")
                else:
                    result['push_error'] = push_result.stderr.strip() or push_result.stdout.strip()
            except FileNotFoundError:
                result['push_error'] = 'git not found'
            except subprocess.TimeoutExpired:
                result['push_error'] = 'Push timed out (30s)'

    def send_json(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    port = PORT

    # Parse --port argument
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == '--port' and i < len(sys.argv) - 1:
            port = int(sys.argv[i + 1])
        elif arg.startswith('--port='):
            port = int(arg.split('=')[1])

    if not os.path.isfile(ENTRIES_FILE):
        print(f"Error: Cannot find {ENTRIES_FILE}")
        print(f"Expected project root at: {PROJECT_ROOT}")
        print("Make sure the script is in the tools/ directory of your project.")
        sys.exit(1)

    try:
        server = http.server.HTTPServer(('127.0.0.1', port), JournalHandler)
    except OSError as e:
        print(f"Error: Could not bind to port {port}: {e}")
        print(f"Try: python3 tools/journal.py --port {port + 1}")
        sys.exit(1)

    url = f'http://127.0.0.1:{port}'
    print(f"\n  Wandering Wojo — Journal Tool")
    print(f"  {url}")
    print(f"  Press Ctrl+C to stop\n")

    # Open browser after a short delay
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Shutting down.")
        server.shutdown()


if __name__ == '__main__':
    main()

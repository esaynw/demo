# demo

_A simple interactive map / geojson-based visualization demo_  

## Overview

This repository contains files for the launch of a web map that displays geospatial data (GeoJSON / JSON)
It’s intended to help visualize bicycle networks and accident data with multiple contributing variables in a browser, and to serve as a starting point for geospatial visualization or analysis projects.  

The data is loaded from GeoJSON / JSON files, which was first preprocessed via a Python script, then rendered in an HTML + JS + CSS frontend.  

##  Contents

- `*.geojson` / `*.json` — processed geospatial data ( bike networks, accident data)  
- `index.html` — main HTML file to load and render the map + data  
- `app_updated.js` — JavaScript logic to load and display the data on the map  
- `style.css` — styling for the map / UI  
-  Python preprocessing script — to prepare / transform  data before use  

##  Getting Started / Usage

- The preprocessed data can be launched directly from a github repository
- The Python code for processing is designed for Google Drive compatibility and usage
- Raw data used to go in Python script can be found here: https://donnees.montreal.ca/dataset/collisions-routieres

## Map
- You can view the project at the live link here: https://esaynw.github.io/demo/
  

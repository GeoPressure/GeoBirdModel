# Habitats crossed by each tracked species, for choosing the background scene of its bird.
#
# Run from the repository root:  Rscript tools/species_habitats.R
#
# Tracks: GeoLocator Explorer's public data (https://geopressure.org/GeoLocatorExplorer/data/):
#   globe.json (tag list), tags/<tag_id>/staps.json (stationary periods: start, end) and
#   tags/<tag_id>/paths.json (most likely position of each stationary period).
# Habitats: RESOLVE Ecoregions 2017 (Dinerstein et al. 2017, BioScience 67:534, CC BY 4.0),
#   grouped into the habitat classes of habitats/habitat_scenes.csv (one per biome, plus
#   Rock & ice, lakes and sea). Names of deserts, mountain ranges, seas and lakes for the
#   barriers: Natural Earth 10m physical layers (public domain).
#
# Method, per tag:
#   - stops: most likely position of each stationary period, weighted by its duration;
#   - flights: great circle between consecutive stops, sampled every 20 km, each sample
#     timed by linear interpolation between take-off and landing and marked night when the
#     sun is below -6 deg there and then (flights longer than 36 h: no day/night);
#   - each position is classified on a 0.05 deg raster of the layers (stops that fall in
#     the sea, i.e. on the coast, take the nearest land class within 0.3 deg).
#   Shares are computed per tag (time for stops, distance for flights), then averaged over
#   the tags of a species, so each tag counts once. Barrier km are mean km per tag over the
#   whole track (both migrations when the tag covers a full year).
#
# Downloads and rasters are cached in work/habitats/ (not in git).
# Urban areas (Natural Earth) take precedence over the biome; big cities (>= 1 M inhabitants)
# within 15 km of the track are landmarks.
#
# Outputs (habitats/):
#   species_habitats.csv  one row per species x phase (stop/flight) x habitat (all tags)
#   species_barriers.csv  deserts, seas, lakes, mountain ranges crossed in flight (all tags)
#   species_summary.csv   one row per species: main habitats, barriers, default scene
#   missing_scenes.csv    habitats ranked by how many species use them, with their scene fit
#   habitats.png          world habitat map (0.1 deg, plate carree) for the scene picker
#   geo/<Genus_species>.json  one track (the gallery's example tag, else the longest): flight
#                         samples [lon, lat, habitat, night, flight], stops [lon, lat, days, habitat],
#                         landmarks with their scene, the default scene
#   geo/index.json        habitats (colour, scene) and species list for the gallery map (scenes/habitat-map.js)
# The habitat -> scene table is habitats/habitat_scenes.csv (edited by hand); a scene key
# '<scene>_night' is used where the bird flew at night (scenes/presets.js).

suppressPackageStartupMessages({
  library(sf); library(terra); library(jsonlite)
})
sf_use_s2(FALSE)
invisible(Sys.setlocale("LC_CTYPE", "en_US.UTF-8"))
`%||%` <- function(a, b) if (is.null(a)) b else a

root <- getwd()
stopifnot(file.exists(file.path(root, "habitats/habitat_scenes.csv")))
work <- file.path(root, "work/habitats")
exp_dir <- file.path(work, "explorer")
lay_dir <- file.path(work, "layers")
dir.create(file.path(exp_dir, "tags"), recursive = TRUE, showWarnings = FALSE)
dir.create(lay_dir, recursive = TRUE, showWarnings = FALSE)
out <- file.path(root, "habitats")
dir.create(file.path(out, "geo"), recursive = TRUE, showWarnings = FALSE)

explorer <- "https://geopressure.org/GeoLocatorExplorer/data"
get <- function(url, dest) {
  if (!file.exists(dest) || file.size(dest) == 0) download.file(url, dest, quiet = TRUE, mode = "wb")
  dest
}

# ---------------------------------------------------------------- layers
layer_zip <- c(
  Ecoregions2017 = "https://storage.googleapis.com/teow2016/Ecoregions2017.zip",
  ne_10m_geography_regions_polys = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_geography_regions_polys.zip",
  ne_10m_geography_marine_polys = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_geography_marine_polys.zip",
  ne_10m_lakes = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_lakes.zip",
  ne_10m_urban_areas = "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_urban_areas.zip",
  ne_10m_populated_places_simple = "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places_simple.zip"
)
shp <- function(name) {
  d <- file.path(lay_dir, name)
  if (!dir.exists(d)) {
    z <- get(layer_zip[[name]], file.path(lay_dir, paste0(name, ".zip")))
    unzip(z, exdir = d)
  }
  st_read(list.files(d, "\\.shp$", full.names = TRUE, recursive = TRUE)[1], quiet = TRUE)
}

hab <- read.csv(file.path(out, "habitat_scenes.csv"), stringsAsFactors = FALSE)
hab$code <- seq_len(nrow(hab))
code_of <- setNames(hab$code, hab$habitat)

tmpl <- rast(xmin = -180, xmax = 180, ymin = -90, ymax = 90, res = 0.05, crs = "EPSG:4326")
cached_raster <- function(name, make) {
  f <- file.path(work, paste0(name, ".tif"))
  if (file.exists(f)) return(rast(f))
  r <- make(); writeRaster(r, f, overwrite = TRUE, datatype = "INT2U"); rast(f)
}

eco <- NULL
eco_tab <- NULL
r_eco <- cached_raster("ecoregions_005", function() {
  eco <<- shp("Ecoregions2017")
  rasterize(vect(eco), tmpl, field = "ECO_ID", touches = FALSE)
})
eco_tab_f <- file.path(work, "ecoregions_table.csv")
if (!file.exists(eco_tab_f)) {
  if (is.null(eco)) eco <- shp("Ecoregions2017")
  write.csv(unique(st_drop_geometry(eco)[, c("ECO_ID", "ECO_NAME", "BIOME_NUM", "BIOME_NAME")]), eco_tab_f, row.names = FALSE)
}
eco_tab <- read.csv(eco_tab_f, stringsAsFactors = FALSE)
eco_tab$habitat <- hab$habitat[match(eco_tab$BIOME_NUM, hab$biome_num)]
eco_tab$habitat[eco_tab$ECO_NAME == "Rock and Ice"] <- "rock_ice"

named_raster <- function(name, layer, filter, namecol) {
  tab_f <- file.path(work, paste0(name, "_names.csv"))
  r <- cached_raster(name, function() {
    g <- shp(layer); g <- g[filter(g), ]
    g$rid <- seq_len(nrow(g))
    # small polygons last so that they win over the large ones they sit in
    g <- g[order(-as.numeric(st_area(st_set_crs(st_geometry(g), NA)))), ]
    n <- enc2utf8(as.character(g[[namecol]]))
    caps <- !is.na(n) & n == toupper(n)   # Natural Earth writes the big ones in capitals
    n[caps] <- gsub("(^|[ (-])([a-z])", "\\1\\U\\2", tolower(n[caps]), perl = TRUE)
    write.csv(data.frame(rid = g$rid, name = n), tab_f, row.names = FALSE, fileEncoding = "UTF-8")
    rasterize(vect(g), tmpl, field = "rid", touches = TRUE)
  })
  list(r = r, names = read.csv(tab_f, stringsAsFactors = FALSE, encoding = "UTF-8"))
}
deserts <- named_raster("deserts_005", "ne_10m_geography_regions_polys", function(g) g$FEATURECLA == "Desert", "NAME")
mountains <- named_raster("mountains_005", "ne_10m_geography_regions_polys", function(g) g$FEATURECLA == "Range/mtn", "NAME")
seas <- named_raster("seas_005", "ne_10m_geography_marine_polys", function(g) rep(TRUE, nrow(g)), "name")
lakes <- named_raster("lakes_005", "ne_10m_lakes", function(g) !is.na(g$scalerank) & g$scalerank <= 4, "name")

r_urban <- cached_raster("urban_005", function() rasterize(vect(shp("ne_10m_urban_areas")), tmpl, field = 1, touches = FALSE))
cities <- local({
  f <- file.path(work, "cities.csv")
  if (!file.exists(f)) {
    g <- st_drop_geometry(shp("ne_10m_populated_places_simple"))
    g <- g[g$pop_max >= 1e6, c("name", "longitude", "latitude", "pop_max")]
    write.csv(g, f, row.names = FALSE, fileEncoding = "UTF-8")
  }
  read.csv(f, stringsAsFactors = FALSE, encoding = "UTF-8")
})
nm <- function(nr, v) nr$names$name[match(v, nr$names$rid)]

classify <- function(lon, lat) {
  xy <- cbind(lon, lat)
  e <- terra::extract(r_eco, xy)[, 1]
  h <- eco_tab$habitat[match(e, eco_tab$ECO_ID)]
  lk <- nm(lakes, terra::extract(lakes$r, xy)[, 1])
  h[is.na(h) & !is.na(lk)] <- "lake"
  h[is.na(h)] <- "sea"
  urb <- terra::extract(r_urban, xy)[, 1]
  h[!is.na(urb) & !h %in% c("sea", "lake")] <- "urban"
  data.frame(
    habitat = h,
    ecoregion = eco_tab$ECO_NAME[match(e, eco_tab$ECO_ID)],
    desert = nm(deserts, terra::extract(deserts$r, xy)[, 1]),
    mountain = nm(mountains, terra::extract(mountains$r, xy)[, 1]),
    sea = ifelse(h == "sea", nm(seas, terra::extract(seas$r, xy)[, 1]), ifelse(h == "lake", lk, NA)),
    stringsAsFactors = FALSE
  )
}
# stops on the coast: nearest land class within 0.3 deg
snap_land <- function(lon, lat) {
  off <- expand.grid(dx = seq(-0.3, 0.3, 0.05), dy = seq(-0.3, 0.3, 0.05))
  off <- off[order(off$dx^2 + off$dy^2), ][-1, ]
  for (i in seq_len(nrow(off))) {
    c1 <- classify(lon + off$dx[i], lat + off$dy[i])
    if (!c1$habitat %in% c("sea", "lake")) return(c1)
  }
  classify(lon, lat)
}

# ---------------------------------------------------------------- tracks
globe <- fromJSON(get(file.path(explorer, "globe.json"), file.path(exp_dir, "globe.json")), simplifyVector = FALSE)
tags <- data.frame(
  tag_id = vapply(globe, `[[`, "", "tag_id"),
  species = vapply(globe, `[[`, "", "scientific_name"),
  english = vapply(globe, function(t) t$common_name %||% "", ""),
  stringsAsFactors = FALSE
)

sun_elev <- function(t, lon, lat) {   # degrees, NOAA approximation
  doy <- as.numeric(format(t, "%j", tz = "UTC"))
  hr <- as.numeric(format(t, "%H", tz = "UTC")) + as.numeric(format(t, "%M", tz = "UTC")) / 60
  g <- 2 * pi / 365 * (doy - 1 + (hr - 12) / 24)
  decl <- 0.006918 - 0.399912 * cos(g) + 0.070257 * sin(g) - 0.006758 * cos(2 * g) +
    0.000907 * sin(2 * g) - 0.002697 * cos(3 * g) + 0.00148 * sin(3 * g)
  eot <- 229.18 * (0.000075 + 0.001868 * cos(g) - 0.032077 * sin(g) - 0.014615 * cos(2 * g) - 0.040849 * sin(2 * g))
  ha <- ((hr * 60 + eot + 4 * lon) / 4 - 180) * pi / 180
  la <- lat * pi / 180
  asin(sin(la) * sin(decl) + cos(la) * cos(decl) * cos(ha)) * 180 / pi
}
gc_points <- function(lon1, lat1, lon2, lat2, step_km = 20) {
  r <- pi / 180
  p1 <- c(cos(lat1 * r) * cos(lon1 * r), cos(lat1 * r) * sin(lon1 * r), sin(lat1 * r))
  p2 <- c(cos(lat2 * r) * cos(lon2 * r), cos(lat2 * r) * sin(lon2 * r), sin(lat2 * r))
  d <- acos(max(-1, min(1, sum(p1 * p2))))
  km <- d * 6371
  n <- max(1, ceiling(km / step_km))
  f <- (seq_len(n) - 0.5) / n   # sample centres, each standing for km/n
  if (d < 1e-9) return(data.frame(lon = lon1, lat = lat1, f = 0.5, km = km))
  a <- sin((1 - f) * d) / sin(d); b <- sin(f * d) / sin(d)
  x <- a * p1[1] + b * p2[1]; y <- a * p1[2] + b * p2[2]; z <- a * p1[3] + b * p2[3]
  data.frame(lon = atan2(y, x) / r, lat = atan2(z, sqrt(x^2 + y^2)) / r, f = f, km = km / n)
}

read_tag <- function(id) {
  d <- file.path(exp_dir, "tags", id); dir.create(d, showWarnings = FALSE)
  st <- fromJSON(get(file.path(explorer, "tags", id, "staps.json"), file.path(d, "staps.json")))
  pa <- fromJSON(get(file.path(explorer, "tags", id, "paths.json"), file.path(d, "paths.json")))
  st <- as.data.frame(st[c("stap_id", "start", "end")]); pa <- as.data.frame(pa)
  if (!nrow(pa) || !nrow(st)) return(NULL)
  ml <- pa[pa$type == "most_likely", ]
  if (!nrow(ml)) ml <- aggregate(cbind(lat, lon) ~ stap_id, pa, median)
  st <- merge(st, ml[, c("stap_id", "lat", "lon")], by = "stap_id")
  st$start <- as.POSIXct(st$start, format = "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
  st$end <- as.POSIXct(st$end, format = "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
  st <- st[!is.na(st$lon) & !is.na(st$lat), ]
  st <- st[order(st$stap_id), ]
  st$days <- pmax(0, as.numeric(difftime(st$end, st$start, units = "days")))
  st
}

stops <- list(); flights <- list(); maps <- list()
for (i in seq_len(nrow(tags))) {
  id <- tags$tag_id[i]
  st <- tryCatch(read_tag(id), error = function(e) { message("skip ", id, ": ", conditionMessage(e)); NULL })
  if (is.null(st) || nrow(st) < 2) next
  cl <- classify(st$lon, st$lat)
  wet <- which(cl$habitat %in% c("sea", "lake"))
  for (j in wet) cl[j, ] <- snap_land(st$lon[j], st$lat[j])
  stops[[id]] <- cbind(tag_id = id, species = tags$species[i], st[, c("stap_id", "lon", "lat", "days")], cl)
  fl <- list()
  for (k in seq_len(nrow(st) - 1)) {
    p <- gc_points(st$lon[k], st$lat[k], st$lon[k + 1], st$lat[k + 1])
    dur <- as.numeric(difftime(st$start[k + 1], st$end[k], units = "hours"))
    tt <- st$end[k] + p$f * dur * 3600
    p$night <- if (is.finite(dur) && dur > 0 && dur <= 36) sun_elev(tt, p$lon, p$lat) < -6 else NA
    p$flight <- k
    fl[[k]] <- p
  }
  fl <- do.call(rbind, fl)
  fl <- fl[fl$km > 0, ]
  if (nrow(fl)) flights[[id]] <- cbind(tag_id = id, species = tags$species[i], fl, classify(fl$lon, fl$lat))
  maps[[id]] <- st
}
stops <- do.call(rbind, stops); flights <- do.call(rbind, flights)
message(length(maps), " tags with tracks, ", length(unique(stops$species)), " species")

# ---------------------------------------------------------------- shares per species
share_by <- function(df, w, key) {   # per tag share of w by key, then mean over tags
  df$w <- df[[w]]; df$key <- df[[key]]
  df <- df[!is.na(df$key), ]
  pt <- aggregate(w ~ tag_id + species + key, df, sum)
  tot <- aggregate(w ~ tag_id, df, sum); names(tot)[2] <- "tot"
  pt <- merge(pt, tot); pt$share <- pt$w / pt$tot
  ntag <- table(unique(df[, c("tag_id", "species")])$species)
  s <- aggregate(cbind(share, w) ~ species + key, pt, sum)
  s$n_tags_with <- aggregate(w ~ species + key, pt, length)$w
  s$share <- s$share / as.numeric(ntag[s$species])
  s$per_tag <- s$w / as.numeric(ntag[s$species])
  s[, c("species", "key", "share", "per_tag", "n_tags_with")]
}
flights$night_km <- ifelse(is.na(flights$night), NA, flights$km * flights$night)
night_by <- function(key) {
  fk <- flights[!is.na(flights$night) & !is.na(flights[[key]]), ]
  fk$key <- fk[[key]]
  a <- aggregate(cbind(night_km, km) ~ species + key, fk, sum)
  a$night_share <- a$night_km / a$km; a[, c("species", "key", "night_share")]
}

st_h <- share_by(stops, "days", "habitat"); st_h$phase <- "stop"
fl_h <- share_by(flights, "km", "habitat"); fl_h$phase <- "flight"
fl_h <- merge(fl_h, night_by("habitat"), all.x = TRUE); st_h$night_share <- NA
long <- rbind(st_h, fl_h[, names(st_h)])
names(long)[names(long) == "key"] <- "habitat"
long$unit <- ifelse(long$phase == "stop", "days", "km")
long <- merge(long, hab[, c("habitat", "label", "scene", "fit")], by = "habitat")
long <- long[order(long$species, long$phase == "flight", -long$share), ]
ntags <- table(unique(stops[, c("tag_id", "species")])$species)
long$n_tags <- as.integer(ntags[long$species])
fmt <- function(x, d = 3) round(x, d)
write.csv(data.frame(
  scientific_name = long$species, phase = long$phase, habitat = long$habitat, habitat_label = long$label,
  share = fmt(long$share), per_tag = round(long$per_tag, 1), per_tag_unit = long$unit,
  night_share = fmt(long$night_share, 2), n_tags_with = long$n_tags_with, n_tags = long$n_tags,
  scene = long$scene, scene_fit = long$fit
), file.path(out, "species_habitats.csv"), row.names = FALSE, na = "", fileEncoding = "UTF-8")

# barriers: deserts, seas, mountain ranges crossed in flight (mean km per tag)
flights$lake <- ifelse(flights$habitat == "lake", flights$sea, NA)
flights$sea[flights$habitat != "sea"] <- NA
bar <- do.call(rbind, lapply(c(desert = "desert", sea = "sea", lake = "lake", mountains = "mountain"), function(k)
  merge(transform(share_by(flights, "km", k), type = names(which(c(desert = "desert", sea = "sea", lake = "lake", mountains = "mountain") == k))),
        night_by(k), all.x = TRUE)))
min_km <- c(desert = 150, sea = 80, lake = 50, mountains = 100)
bar <- bar[bar$per_tag >= min_km[bar$type], ]
bar <- bar[order(bar$species, -bar$per_tag), ]
write.csv(data.frame(scientific_name = bar$species, barrier = bar$key, type = bar$type,
                     km_per_tag = round(bar$per_tag), night_share = round(bar$night_share, 2),
                     n_tags_with = bar$n_tags_with),
          file.path(out, "species_barriers.csv"), row.names = FALSE, na = "", fileEncoding = "UTF-8")

# ---------------------------------------------------------------- one track per species, with landmarks
gallery_tag <- local({
  g <- fromJSON(file.path(root, "gallery.json"))$birds
  g <- g[!is.na(g$tag_id) & nzchar(g$tag_id), ]
  as.list(setNames(g$tag_id, g$scientific_name))
})
LANDMARK_SCENE <- c(desert = "sahara", sea = "sea", lake = "sea", mountains = "alps", city = "city")
hab_index <- function(h) match(h, hab$habitat) - 1L   # 0-based, as in index.json
track_json <- function(sp, eng, tid, n_tags, default, reason) {
  st <- stops[stops$tag_id == tid, ]
  fl <- flights[flights$tag_id == tid, ]
  fl$i <- seq_len(nrow(fl))
  # landmarks along this track: one per named desert group, sea, lake, range, big city
  lm <- list()
  add <- function(name, type, idx) {
    if (!length(idx)) return()
    run <- split(idx, cumsum(c(1, diff(idx) != 1)))          # contiguous stretches
    best <- run[[which.max(lengths(run))]]
    mid <- best[ceiling(length(best) / 2)]
    nt <- fl$night[idx]
    lm[[length(lm) + 1]] <<- data.frame(name = name, type = type, lon = round(fl$lon[mid], 2), lat = round(fl$lat[mid], 2),
      km = round(sum(fl$km[idx])), night = if (all(is.na(nt))) NA else round(mean(nt, na.rm = TRUE), 2),
      scene = night_scene(LANDMARK_SCENE[[type]], if (all(is.na(nt))) NA else mean(nt, na.rm = TRUE)))
  }
  d_idx <- which(fl$habitat == "desert")
  if (sum(fl$km[d_idx]) >= 300) {
    dn <- table(fl$desert[d_idx]); add(if (length(dn)) names(which.max(dn)) else "Desert", "desert", d_idx)
  }
  for (k in c("sea", "lake", "mountain")) {
    v <- fl[[k]]; if (all(is.na(v))) next
    tab <- tapply(fl$km, v, sum); tab <- sort(tab[tab >= c(sea = 60, lake = 40, mountain = 80)[[k]]], decreasing = TRUE)
    for (n in head(names(tab), c(sea = 2, lake = 1, mountain = 1)[[k]])) add(n, if (k == "mountain") "mountains" else k, which(v == n))
  }
  # big cities overflown (within 15 km of the line)
  dkm <- function(lon1, lat1, lon2, lat2) 6371 * acos(pmin(1, sin(lat1 * pi / 180) * sin(lat2 * pi / 180) + cos(lat1 * pi / 180) * cos(lat2 * pi / 180) * cos((lon2 - lon1) * pi / 180)))
  near <- lapply(seq_len(nrow(cities)), function(j) which(dkm(fl$lon, fl$lat, cities$longitude[j], cities$latitude[j]) <= 15))
  cj <- which(lengths(near) > 0); cj <- head(cj[order(-cities$pop_max[cj])], 2)
  for (j in cj) add(cities$name[j], "city", near[[j]])
  lm <- if (length(lm)) do.call(rbind, lm) else data.frame()
  # default scene of this track: its desert crossing, else its longest sea crossing (>= 200 km),
  # else a mountain range crossed over >= 550 km
  big <- if (nrow(lm)) lm[lm$type == "desert" | (lm$type == "sea" & lm$km >= 200) | (lm$type == "mountains" & lm$km >= 550), ] else lm
  if (nrow(big)) {
    big <- big[order(match(big$type, c("desert", "sea", "mountains")), -big$km), ][1, ]
    default <- big$scene
    reason <- sprintf("this track crosses the %s (%d km%s)", big$name, big$km,
                      ifelse(is.na(big$night), "", paste0(", ", pct(big$night), " at night")))
  }
  # the track: flight samples every ~40 km with habitat and day/night, stops with duration
  keep <- fl[fl$i %% 2 == 1 | !duplicated(fl$flight), ]
  path <- unname(as.matrix(data.frame(round(keep$lon, 2), round(keep$lat, 2), hab_index(keep$habitat),
                                      ifelse(is.na(keep$night), -1L, as.integer(keep$night)), keep$flight)))
  stp <- unname(as.matrix(data.frame(round(st$lon, 2), round(st$lat, 2), round(st$days, 1), hab_index(st$habitat))))
  ll <- rbind(st[, c("lon", "lat")], fl[, c("lon", "lat")])
  list(scientific_name = sp, english_name = eng, tag_id = tid, n_tags = n_tags,
       start = format(min(maps[[tid]]$start), "%Y-%m-%d"), end = format(max(maps[[tid]]$end), "%Y-%m-%d"),
       bbox = round(c(min(ll$lon), min(ll$lat), max(ll$lon), max(ll$lat)), 1),
       default_scene = default, default_reason = reason,
       path = path, stops = stp, landmarks = lm)
}

# ---------------------------------------------------------------- default scene and summary
night_all <- aggregate(cbind(night_km, km) ~ species, flights[!is.na(flights$night), ], sum)
night_all <- setNames(night_all$night_km / night_all$km, night_all$species)
pct <- function(x) paste0(round(100 * x), "%")
night_scene <- function(scene, night_share) if (!is.na(night_share) && night_share >= 0.5) paste0(scene, "_night") else scene
species_list <- sort(unique(stops$species))
summ <- list(); geo_index <- list()
for (sp in species_list) {
  s_st <- st_h[st_h$species == sp, ]; s_st <- s_st[order(-s_st$share), ]
  s_fl <- fl_h[fl_h$species == sp, ]; s_fl <- s_fl[order(-s_fl$share), ]
  s_fl$night_share <- fl_h$night_share[match(paste(sp, s_fl$key), paste(fl_h$species, fl_h$key))]
  b <- bar[bar$species == sp, ]; b <- b[seq_len(min(nrow(b), 8)), ]
  ns <- unname(night_all[sp])
  # default scene: the biggest barrier first (desert, then sea), else the main habitat in flight
  d_km <- s_fl$per_tag[s_fl$key == "desert"]; d_km <- if (length(d_km)) d_km else 0
  seas_b <- b[b$type == "sea", ]
  if (d_km >= 500) {
    n_d <- fl_h$night_share[fl_h$species == sp & fl_h$key == "desert"]
    default <- night_scene("sahara", n_d)
    main_d <- b$key[b$type == "desert"][1]
    reason <- sprintf("crosses %s deserts (%d km per tag, %s at night)",
                      ifelse(is.na(main_d), "", paste0("the ", main_d, " and other")), round(d_km), pct(n_d))
    reason <- sub("crosses  deserts", "crosses deserts", reason)
  } else if (nrow(seas_b) && seas_b$per_tag[1] >= 200) {
    default <- night_scene("sea", seas_b$night_share[1]); reason <- sprintf("crosses the %s (%d km per tag)", seas_b$key[1], round(seas_b$per_tag[1]))
  } else {
    top <- s_fl$key[1]; hm <- hab[hab$habitat == top, ]
    default <- night_scene(hm$scene, s_fl$night_share[1])
    reason <- sprintf("main habitat in flight: %s (%s of distance)", hm$label, pct(s_fl$share[1]))
  }
  lab <- function(df) { df <- df[df$share >= 0.05, ]; paste(sprintf("%s %s", hab$label[match(df$key, hab$habitat)], pct(df$share)), collapse = "; ") }
  bar_txt <- paste(sprintf("%s (%s, %d km%s)", b$key, b$type, round(b$per_tag),
                           ifelse(is.na(b$night_share), "", paste0(", ", pct(b$night_share), " at night"))), collapse = "; ")
  eng <- tags$english[match(sp, tags$species)]
  summ[[sp]] <- data.frame(scientific_name = sp, english_name = eng, n_tags = as.integer(ntags[sp]),
    stop_habitats = lab(s_st), flight_habitats = lab(s_fl), barriers = bar_txt,
    night_flight_share = round(ns, 2), default_scene = default, default_reason = reason)

  # one representative track for the scene picker: the gallery's example tag, else the tag
  # with the longest flight distance
  ids <- unique(stops$tag_id[stops$species == sp])
  km_tag <- tapply(flights$km[flights$species == sp], flights$tag_id[flights$species == sp], sum)
  tid <- gallery_tag[[sp]]
  if (is.null(tid) || !tid %in% names(maps)) tid <- names(which.max(km_tag))
  write_json(track_json(sp, eng, tid, length(ids), default, reason),
             file.path(out, "geo", paste0(gsub(" ", "_", sp), ".json")), auto_unbox = TRUE, digits = NA)
  fname <- gsub(" ", "_", sp)
  geo_index[[sp]] <- list(scientific_name = sp, english_name = eng, file = paste0("geo/", fname, ".json"),
                          model = paste0("models/", fname, ".glb"), n_tags = as.integer(ntags[sp]), tag_id = tid,
                          default_scene = default)
}
summ <- do.call(rbind, summ)
write.csv(summ, file.path(out, "species_summary.csv"), row.names = FALSE, na = "", fileEncoding = "UTF-8")
write_json(list(
  habitats = hab[, c("habitat", "label", "colour", "scene", "fit")],
  species = unname(geo_index),
  sources = c("Tracks: GeoLocator Explorer / Master GeoLocator Data Package (most likely paths)",
              "Habitats: RESOLVE Ecoregions 2017, Dinerstein et al. 2017, CC BY 4.0",
              "Seas, lakes, deserts, mountains, urban areas, cities: Natural Earth (public domain)")
), file.path(out, "geo", "index.json"), auto_unbox = TRUE, pretty = TRUE)

# ---------------------------------------------------------------- missing scenes ranking
u <- long[long$share >= 0.05, ]
rk <- do.call(rbind, lapply(split(u, u$habitat), function(d) data.frame(
  habitat = d$habitat[1],
  n_species = length(unique(d$species)),
  n_species_stop = length(unique(d$species[d$phase == "stop"])),
  n_species_flight = length(unique(d$species[d$phase == "flight"])),
  sum_stop_share = round(sum(d$share[d$phase == "stop"]), 2),
  sum_flight_share = round(sum(d$share[d$phase == "flight"]), 2),
  species = paste(sort(unique(d$species)), collapse = "; "))))
rk <- merge(hab[, c("habitat", "label", "scene", "fit")], rk, all.x = TRUE)
rk$n_species[is.na(rk$n_species)] <- 0
rk$need <- ifelse(rk$fit %in% c("none", "poor"), "build", ifelse(rk$fit == "fair", "could improve", "covered"))
rk <- rk[order(factor(rk$need, c("build", "could improve", "covered")), -rk$n_species, -(rk$sum_stop_share + rk$sum_flight_share)), ]
write.csv(rk, file.path(out, "missing_scenes.csv"), row.names = FALSE, na = "", fileEncoding = "UTF-8")

# ---------------------------------------------------------------- habitat map image
r01 <- aggregate(r_eco, 2, fun = "modal", na.rm = TRUE)
v <- values(r01)[, 1]
h <- eco_tab$habitat[match(v, eco_tab$ECO_ID)]
lk01 <- aggregate(lakes$r, 2, fun = "modal", na.rm = TRUE)
h[is.na(h) & !is.na(values(lk01)[, 1])] <- "lake"
h[is.na(h)] <- "sea"
u01 <- aggregate(r_urban, 2, fun = "max", na.rm = TRUE)
h[!is.na(values(u01)[, 1]) & !h %in% c("sea", "lake")] <- "urban"
col <- col2rgb(hab$colour[match(h, hab$habitat)]) / 255
img <- array(0, c(nrow(r01), ncol(r01), 3))
for (k in 1:3) img[, , k] <- matrix(col[k, ], nrow(r01), ncol(r01), byrow = TRUE)
png::writePNG(img, file.path(out, "habitats.png"))
message("done: ", nrow(summ), " species")

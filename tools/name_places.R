# Key places of each species' track for the gallery map: breeding site, wintering site and the
# longest stopovers, named after the nearest town (Natural Earth populated places), the country
# and the RESOLVE ecoregion. Reads habitats/geo/<Genus_species>.json (tools/species_habitats.R),
# writes habitats/places.json. Run from the repo root after species_habitats.R (uses its cache in
# work/habitats/):   Rscript tools/name_places.R
suppressPackageStartupMessages({ library(sf); library(terra); library(jsonlite) })
sf_use_s2(FALSE)
cache <- "work/habitats"
pp <- st_read(file.path(cache, "layers/ne_10m_populated_places_simple"), quiet = TRUE)
pp <- data.frame(name = pp$name, adm1 = pp$adm1name, adm0 = pp$adm0name, pop = pp$pop_max,
                 lon = st_coordinates(pp)[, 1], lat = st_coordinates(pp)[, 2])
eco <- rast(file.path(cache, "ecoregions_005.tif"))
eco_tab <- read.csv(file.path(cache, "ecoregions_table.csv"))

km <- function(lon1, lat1, lon2, lat2) {   # great-circle distance
  r <- pi / 180
  a <- sin((lat2 - lat1) * r / 2)^2 + cos(lat1 * r) * cos(lat2 * r) * sin((lon2 - lon1) * r / 2)^2
  6371 * 2 * asin(pmin(1, sqrt(a)))
}
name_of <- function(lon, lat) {
  d <- km(lon, lat, pp$lon, pp$lat)
  near <- which(d < 60)
  # a large and near town within 60 km (sqrt(population) / distance^2), else the nearest one
  i <- if (length(near)) near[which.max(sqrt(pp$pop[near]) / (1 + d[near] / 8)^2)] else which.min(d)
  e <- terra::extract(eco, cbind(lon, lat))[1, 1]
  list(town = if (d[i] < 250) pp$name[i] else NA, town_km = round(d[i]),
       region = pp$adm1[i], country = if (d[i] < 400) pp$adm0[i] else NA,
       ecoregion = if (!is.na(e)) eco_tab$ECO_NAME[match(e, eco_tab$ECO_ID)] else NA)
}

files <- list.files("habitats/geo", pattern = "^[A-Z].*\\.json$", full.names = TRUE)
out <- list()
for (f in files) {
  g <- fromJSON(f, simplifyVector = FALSE)
  S <- do.call(rbind, lapply(g$stops, function(s) unlist(s)[1:4]))
  if (is.null(S) || !nrow(S)) next
  S <- as.data.frame(S); names(S) <- c("lon", "lat", "days", "hab"); S$i <- seq_len(nrow(S))
  # group stops within 100 km of the group's first stop (in time order)
  grp <- integer(nrow(S)); heads <- integer(0)
  for (k in seq_len(nrow(S))) {
    hit <- heads[km(S$lon[k], S$lat[k], S$lon[heads], S$lat[heads]) < 100]
    if (length(hit)) grp[k] <- grp[hit[1]] else { heads <- c(heads, k); grp[k] <- k }
  }
  G <- do.call(rbind, lapply(split(S, grp), function(x) {
    w <- which.max(x$days)
    data.frame(lon = x$lon[w], lat = x$lat[w], days = sum(x$days), hab = x$hab[w], first = min(x$i), last = max(x$i))
  }))
  G <- G[order(G$first), ]
  b <- 1                                           # the track starts at the breeding (tagging) site
  far <- km(G$lon[b], G$lat[b], G$lon, G$lat) > 800
  w <- if (any(far & G$days >= 30)) which(far & G$days >= 30)[which.max(G$days[far & G$days >= 30])] else NA
  kind <- rep(NA_character_, nrow(G)); kind[b] <- "breeding"; if (!is.na(w)) kind[w] <- "wintering"
  rest <- which(is.na(kind) & G$days >= 5)
  rest <- rest[order(-G$days[rest])][seq_len(min(3, length(rest)))]
  kind[rest] <- "stopover"
  keep <- which(!is.na(kind))
  out[[g$scientific_name]] <- lapply(keep, function(k) {
    n <- name_of(G$lon[k], G$lat[k])
    c(list(kind = kind[k], lon = G$lon[k], lat = G$lat[k], days = round(G$days[k], 1), habitat = G$hab[k],
           order = G$first[k]), n)
  })
}
write_json(out, "habitats/places.json", auto_unbox = TRUE, pretty = TRUE, na = "null", digits = NA)
cat("places for", length(out), "species\n")

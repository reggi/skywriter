#!/bin/bash
# Generate test images with EXIF data using ImageMagick and exiftool
# Run this script to generate base64-encoded test images with GPS EXIF data

set -e

TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "Generating test images with EXIF data..."

# Create 100x100 black square JPEG
convert -size 100x100 xc:black "$TEMP_DIR/test.jpg"

# Add GPS EXIF data using exiftool
# GPS: 40.7128° N, 74.0060° W (New York City)
exiftool -overwrite_original \
  "-GPSLatitude=40.7128" \
  "-GPSLatitudeRef=N" \
  "-GPSLongitude=74.0060" \
  "-GPSLongitudeRef=W" \
  "-GPSAltitude=0" \
  "-GPSAltitudeRef=Above Sea Level" \
  "-UserComment=Test image with GPS coordinates" \
  "$TEMP_DIR/test.jpg"

# Create 100x100 black square PNG
convert -size 100x100 xc:black "$TEMP_DIR/test.png"

# Add text metadata to PNG using exiftool
exiftool -overwrite_original \
  "-Comment=GPS Location: 40.7128N 74.0060W" \
  "-Artist=Test Suite" \
  "-Copyright=Test Image" \
  "$TEMP_DIR/test.png"

# Output base64 encoded images
echo "JPEG with GPS EXIF (base64):"
echo "const jpegBase64 = \`"
base64 < "$TEMP_DIR/test.jpg" | fold -w 76
echo "\`"

echo ""
echo "PNG with Metadata (base64):"
echo "const pngBase64 = \`"
base64 < "$TEMP_DIR/test.png" | fold -w 76
echo "\`"

# Verify EXIF data is present
echo ""
echo "Verifying JPEG EXIF data:"
exiftool "$TEMP_DIR/test.jpg" | grep -i "gps\|latitude\|longitude" || true

echo ""
echo "Verifying PNG metadata:"
exiftool "$TEMP_DIR/test.png" | grep -i "comment\|artist\|copyright" || true

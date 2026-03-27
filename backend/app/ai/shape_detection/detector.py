import cv2
import numpy as np
import base64
from typing import List, Dict, Any


class ShapeDetector:
    """OpenCV-based shape detection from both point arrays and images."""

    def detect_from_image(self, image_base64: str) -> List[Dict[str, Any]]:
        """
        Detect shapes from a base64-encoded image using contour analysis.
        Returns a list of detected shapes with bounding boxes.
        """
        # Decode base64 image
        encoded_data = image_base64.split(",", 1)[-1] if "," in image_base64 else image_base64
        nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            return []

        # Pre-processing pipeline: Grayscale -> Gaussian Blur -> Otsu Thresholding
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # Invert so strokes are white on black (canvas bg is light)
        _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)

        # Morphological closing to connect broken strokes
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)

        # Find contours
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        shapes = []
        img_h, img_w = img.shape[:2]
        min_area = (img_w * img_h) * 0.001  # ignore tiny noise contours

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < min_area:
                continue

            shape = self._classify_contour(cnt)
            if shape:
                shapes.append(shape)

        return shapes

    def _classify_contour(self, cnt: np.ndarray) -> Dict[str, Any] | None:
        """Classify a single contour into a shape type."""
        x, y, w, h = cv2.boundingRect(cnt)
        perimeter = cv2.arcLength(cnt, True)
        area = cv2.contourArea(cnt)

        if perimeter == 0:
            return None

        # Approximate polygon
        approx = cv2.approxPolyDP(cnt, 0.03 * perimeter, True)
        vertices = len(approx)

        # Check if it's an arrow (open stroke with directional endpoint)
        if self._is_arrow(cnt, approx):
            pts = cnt.reshape(-1, 2)
            start = pts[0]
            end = pts[-1]
            return {
                "type": "arrow",
                "x": float(x), "y": float(y),
                "width": float(w), "height": float(h),
                "points": [float(start[0]), float(start[1]), float(end[0]), float(end[1])],
                "confidence": 0.8,
            }

        # Circularity test
        circularity = 4 * np.pi * (area / (perimeter * perimeter))

        if circularity > 0.7 and vertices > 5:
            # Circle
            (cx, cy), radius = cv2.minEnclosingCircle(cnt)
            return {
                "type": "circle",
                "x": float(cx - radius), "y": float(cy - radius),
                "width": float(radius * 2), "height": float(radius * 2),
                "radius": float(radius),
                "confidence": min(circularity, 1.0),
            }

        if vertices == 3:
            return {
                "type": "triangle",
                "x": float(x), "y": float(y),
                "width": float(w), "height": float(h),
                "confidence": 0.85,
            }

        if vertices == 4:
            # Check for diamond vs rectangle
            rect_area = w * h
            fill_ratio = area / rect_area if rect_area > 0 else 0
            if fill_ratio < 0.65:
                return {
                    "type": "diamond",
                    "x": float(x), "y": float(y),
                    "width": float(w), "height": float(h),
                    "confidence": 0.85,
                }
            return {
                "type": "rectangle",
                "x": float(x), "y": float(y),
                "width": float(w), "height": float(h),
                "confidence": 0.9,
            }

        if vertices >= 5 and circularity > 0.5:
            (cx, cy), radius = cv2.minEnclosingCircle(cnt)
            return {
                "type": "circle",
                "x": float(cx - radius), "y": float(cy - radius),
                "width": float(radius * 2), "height": float(radius * 2),
                "radius": float(radius),
                "confidence": circularity,
            }

        return {
            "type": "rectangle",
            "x": float(x), "y": float(y),
            "width": float(w), "height": float(h),
            "confidence": 0.6,
        }

    def _is_arrow(self, cnt: np.ndarray, approx: np.ndarray) -> bool:
        """Heuristic to detect arrow-like shapes."""
        pts = cnt.reshape(-1, 2)
        if len(pts) < 5:
            return False

        # Check if the shape is elongated and open-ish
        x, y, w, h = cv2.boundingRect(cnt)
        aspect = max(w, h) / (min(w, h) + 1e-6)

        # Arrows tend to be elongated
        if aspect < 2.0:
            return False

        # Check convexity defects — arrows have a pointed end
        hull = cv2.convexHull(cnt, returnPoints=False)
        if len(hull) < 4:
            return False

        try:
            defects = cv2.convexityDefects(cnt, hull)
            if defects is not None and len(defects) >= 2:
                # Multiple deep defects suggest an arrowhead
                deep_defects = [d for d in defects if d[0][3] > 1000]
                return len(deep_defects) >= 1
        except cv2.error:
            pass

        return False

    def detect(self, points: List[Dict[str, float]]) -> Dict[str, Any]:
        """
        Legacy: Takes a list of stroke points and classifies the shape.
        Kept for backward compatibility with the /canvas/detect-shapes endpoint.
        """
        if not points or len(points) < 2:
            return {"type": "unknown", "x": 0, "y": 0, "width": 0, "height": 0}

        pts = np.array([[p["x"], p["y"]] for p in points], dtype=np.int32)
        cnt = pts.reshape((-1, 1, 2))

        x, y, w, h = cv2.boundingRect(cnt)
        perimeter = cv2.arcLength(cnt, True)

        # Check for straight line
        start, end = pts[0], pts[-1]
        dist = float(np.linalg.norm(start - end))
        path_length = float(sum(np.linalg.norm(pts[i] - pts[i - 1]) for i in range(1, len(pts))))

        if path_length > 0 and dist / path_length > 0.9:
            return {
                "type": "line",
                "x": float(x), "y": float(y),
                "width": float(w), "height": float(h),
            }

        approx = cv2.approxPolyDP(cnt, 0.04 * perimeter, True)
        vertices = len(approx)

        shape_type = "unknown"

        if vertices == 3:
            shape_type = "triangle"
        elif vertices == 4:
            rect_area = w * h
            contour_area = cv2.contourArea(cnt)
            if rect_area > 0 and (contour_area / rect_area) < 0.6:
                shape_type = "diamond"
            else:
                shape_type = "rectangle"
        elif vertices > 4:
            area = cv2.contourArea(cnt)
            if perimeter > 0:
                circularity = 4 * np.pi * (area / (perimeter * perimeter))
                if circularity > 0.7:
                    shape_type = "circle"

        return {
            "type": shape_type,
            "x": float(x), "y": float(y),
            "width": float(w), "height": float(h),
        }

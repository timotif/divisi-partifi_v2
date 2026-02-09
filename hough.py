import cv2 as cv
import numpy as np
import matplotlib
import matplotlib.pyplot as plt
from tqdm import tqdm

matplotlib.use('TkAgg')

ANGLE_THRESHOLD = np.pi / 180 * 2  # 2 degrees tolerance
IMG = "./backend/img/page_0.png"

# Reference image: music.png (732x980) — tuned parameters for this resolution
REF_WIDTH = 732
REF_HEIGHT = 980

# Tuned values for the reference image
REF_CANNY_LOW = 20
REF_CANNY_HIGH = 80
REF_HOUGH_THRESHOLD = 450
DILATE_KERNEL_W = 5  # Fixed — gap bridging doesn't depend on resolution
REF_DEDUP_RHO = 20

def estimate_params(img):
	"""Estimate Canny/Hough/dilation parameters based on image size relative to reference.

	The reference image (music.png, 732x980) has known-good parameters.
	We scale linearly with the geometric mean of width/height ratios,
	since a 2x larger image has ~2x longer staff lines and ~2x more edge pixels.
	"""
	h, w = img.shape[:2]
	scale = np.sqrt((w / REF_WIDTH) * (h / REF_HEIGHT))

	params = {
		"canny_low": int(round(REF_CANNY_LOW * scale)),
		"canny_high": int(round(REF_CANNY_HIGH * scale)),
		# Sub-linear: longer lines get more votes but not proportionally.
		# Calibrated: 450 @ 1.0x, ~900 @ 2.67x (exponent 0.7).
		"hough_threshold": int(round(REF_HOUGH_THRESHOLD * (scale ** 0.7))),
		"dilate_kernel_w": DILATE_KERNEL_W,
		"dedup_rho": max(5, int(round(REF_DEDUP_RHO * scale))),
	}

	print(f"Image: {w}x{h}, scale factor: {scale:.2f}")
	print(f"Params: canny=({params['canny_low']}, {params['canny_high']}), "
		  f"hough_thresh={params['hough_threshold']}, "
		  f"dilate_kernel={params['dilate_kernel_w']}, "
		  f"dedup_rho={params['dedup_rho']}")
	return params

def apply_filters(img):
	filtered_img = img.copy()
	print("Converting to grayscale...")
	filtered_img = cv.cvtColor(img, cv.COLOR_BGR2GRAY)
	return filtered_img

def filter_by_angle(lines, target_angle, threshold, dedup_rho=20):
	filtered = [line for line in lines if abs(line[0][1] - target_angle) % np.pi < threshold]
	unique_filtered = []
	for line in filtered:
		rho, theta = line[0]
		if not any(abs(rho - l[0][0]) < dedup_rho and abs(theta - l[0][1]) < threshold for l in unique_filtered):
			unique_filtered.append(line)
	return unique_filtered

def draw_lines(img, lines, color, subplot, tag: str):
	if lines is not None:
		print(f"Drawing {tag} on image...")
		for line in tqdm(lines, desc=f"Processing {tag}"):
			rho, theta = line[0]
			a = np.cos(theta)
			b = np.sin(theta)
			x0 = a * rho
			y0 = b * rho
			x1 = int(x0 + 3000 * (-b))
			y1 = int(y0 + 3000 * (a))
			x2 = int(x0 - 3000 * (-b))
			y2 = int(y0 - 3000 * (a))
			cv.line(img, (x1, y1), (x2, y2), color, 2)
		images_to_plot.append((img, subplot))

def plot_images(images: list[tuple[np.ndarray, int]]):
	plt.figure(figsize=(30, 30))
	for img, subplot in images:
		plt.subplot(subplot)
		plt.imshow(img)
	plt.show()

def process_image(img_file):
	print("Loading image...")
	img = cv.imread(img_file)
	params = estimate_params(img)
	filtered_img = apply_filters(img)
	images_to_plot.append((filtered_img, 141))

	print("Detecting edges...")
	edges = cv.Canny(filtered_img, params["canny_low"], params["canny_high"], apertureSize=3)

	# Dilate to connect broken/faint horizontal lines
	print("Dilating edges...")
	kernel = cv.getStructuringElement(cv.MORPH_RECT, (params["dilate_kernel_w"], 1))
	edges = cv.dilate(edges, kernel, iterations=1)

	images_to_plot.append((edges, 142))
	print("Detecting lines with Hough transform...")
	lines = cv.HoughLines(edges, 1, np.pi / 180, params["hough_threshold"])
	return img, filtered_img, lines, params

images_to_plot = [] # List of (image, subplot) tuples for plotting

def main():
	for _ in range(4):
		IMG = f'./backend/img/page_{_}.png'	
		THETA_VERTICAL = 0
		THETA_HORIZONTAL = np.pi / 2

		img, filtered_img, lines, params = process_image(IMG)
		print(f"Total lines detected: {len(lines) if lines is not None else 0}")

		dedup_rho = params["dedup_rho"]
		vertical_lines = filter_by_angle(lines, THETA_VERTICAL, ANGLE_THRESHOLD, dedup_rho)
		horizontal_lines = filter_by_angle(lines, THETA_HORIZONTAL, ANGLE_THRESHOLD, dedup_rho)

		print(f"Found {len(vertical_lines)} vertical lines and {len(horizontal_lines)} horizontal lines.")
		draw_lines(img.copy(), vertical_lines, (0, 255, 0), 143, "vertical lines")
		draw_lines(img.copy(), horizontal_lines, (255, 0, 0), 144, "horizontal lines")

		print("Rendering plot...")
		plot_images(images_to_plot)

		print("Done! Plot is ready.")

if __name__ == "__main__":
	main()
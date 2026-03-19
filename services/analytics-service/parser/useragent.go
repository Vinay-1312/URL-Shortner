package parser

import "github.com/mssola/useragent"

// ParsedUA holds structured fields extracted from a raw User-Agent string.
type ParsedUA struct {
	Browser        string
	BrowserVersion string
	OS             string
	DeviceType     string // mobile | tablet | desktop | bot
}

// Parse extracts browser, OS, and device information from a raw UA string.
func Parse(rawUA string) ParsedUA {
	if rawUA == "" {
		return ParsedUA{DeviceType: "unknown"}
	}

	ua := useragent.New(rawUA)

	browser, version := ua.Browser()

	deviceType := "desktop"
	if ua.Bot() {
		deviceType = "bot"
	} else if ua.Mobile() {
		deviceType = "mobile"
	}

	return ParsedUA{
		Browser:        browser,
		BrowserVersion: version,
		OS:             ua.OS(),
		DeviceType:     deviceType,
	}
}

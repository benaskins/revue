package revue

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
)

var prURLPattern = regexp.MustCompile(`github\.com/([^/]+)/([^/]+)/pull/(\d+)`)

// PRRef identifies a GitHub pull request.
type PRRef struct {
	Owner  string `json:"owner"`
	Repo   string `json:"repo"`
	Number string `json:"number"`
}

// ParsePRURL extracts owner, repo, and number from a GitHub PR URL.
func ParsePRURL(url string) (PRRef, error) {
	matches := prURLPattern.FindStringSubmatch(url)
	if matches == nil {
		return PRRef{}, fmt.Errorf("invalid PR URL: %s", url)
	}
	return PRRef{
		Owner:  matches[1],
		Repo:   matches[2],
		Number: matches[3],
	}, nil
}

// GitHubClient fetches PR diffs from the GitHub API.
type GitHubClient struct {
	token      string
	httpClient *http.Client
}

// NewGitHubClient creates a client, optionally with a personal access token.
func NewGitHubClient(token string) *GitHubClient {
	return &GitHubClient{
		token:      token,
		httpClient: &http.Client{},
	}
}

// FetchDiff fetches the unified diff for a pull request.
func (c *GitHubClient) FetchDiff(ctx context.Context, ref PRRef) (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/pulls/%s",
		ref.Owner, ref.Repo, ref.Number)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github.v3.diff")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// Retry without auth on 401 — token may be expired but repo may be public
	if resp.StatusCode == http.StatusUnauthorized && c.token != "" {
		resp.Body.Close()
		req, err = http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return "", err
		}
		req.Header.Set("Accept", "application/vnd.github.v3.diff")
		resp, err = c.httpClient.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return "", fmt.Errorf("GitHub API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
